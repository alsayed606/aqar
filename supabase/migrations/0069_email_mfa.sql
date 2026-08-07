-- 0069_email_mfa.sql
-- التحقّق بخطوتين برمز يُرسَل — قناة البريد الآن، والرسائل النصية لاحقاً.
--
-- WHY THIS EXISTS
-- Until now the only second factor was Supabase's TOTP: an authenticator app, a QR code, and a
-- secret the user must not lose. That is the strongest option and it stays — but it asks a property
-- office to install and understand an app before it can sign in, and the owner judged that cost too
-- high. A six-digit code delivered to the address the account already uses costs the user nothing new.
--
-- WHAT IT IS AND IS NOT
-- Email OTP stops a LEAKED PASSWORD. It does not stop a TAKEN INBOX — whoever reads the mailbox can
-- already reset the password, so the inbox was always the real key to the account. Anyone who wants
-- protection against that keeps TOTP, which this migration does not touch.
--
-- WHY OUR OWN TABLES AND NOT SUPABASE'S FACTORS
-- GoTrue's factor API knows TOTP and phone; it has no e-mail factor, and its Authenticator Assurance
-- Level therefore cannot represent one. So the state lives here and the gate is ours (middleware asks
-- app.mfa_state). Everything is keyed by CHANNEL from the first row, so adding 'sms' later is a
-- destination and a sender — not a second design.
--
-- THE CODE IS NEVER IN THIS DATABASE
-- The app generates the six digits, hashes them, and stores only the hash (the same discipline the
-- dropped 0004 phone-OTP tables used). Postgres can neither read a live code nor leak one in a dump.
--
-- ---------------------------------------------------------------------------
-- Which session is asking?
-- ---------------------------------------------------------------------------
-- Step-up must be per SESSION, not per user: proving the code on a phone must not silently unlock a
-- laptop someone else is holding. GoTrue puts `session_id` in every access token, and taking it from
-- the verified JWT rather than from a parameter means a caller cannot claim to be another session.
create or replace function app.current_session_id() returns uuid
language sql stable set search_path = app, pg_temp as $$
  select app.uuid_or_null(nullif(current_setting('request.jwt.claims', true), '') ::jsonb ->> 'session_id')
$$;

-- ---------------------------------------------------------------------------
-- The factor: one delivery destination per person.
-- ---------------------------------------------------------------------------
create table if not exists app.mfa_factor (
  -- One factor per identity on purpose. Two addresses would double the ways in, and the second
  -- address is exactly what an attacker who already holds the session would add.
  identity_id  uuid primary key references app.identity(id) on delete cascade,
  channel      text not null default 'email' check (channel in ('email', 'sms')),
  -- Frozen at enrolment. It is NOT read live from app.identity.email: were it live, changing the
  -- e-mail address would silently redirect the second factor, and the address change is precisely
  -- what a second factor is supposed to stand in the way of.
  destination  text not null,
  -- Null until a code sent to that destination came back correct. An abandoned enrolment must never
  -- gate anything, and must never claim the user is protected when they are not.
  verified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The challenge: a hashed, single-use, expiring code.
-- ---------------------------------------------------------------------------
create table if not exists app.mfa_challenge (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references app.identity(id) on delete cascade,
  -- Scoped to the session that asked. A code mailed to one browser must not open another.
  session_id   uuid not null,
  purpose      text not null check (purpose in ('enroll', 'step_up')),
  code_hash    text not null,
  attempts     int  not null default 0,
  max_attempts int  not null default 5,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists mfa_challenge_open_idx
  on app.mfa_challenge (identity_id, session_id, purpose, created_at desc)
  where consumed_at is null;

-- ---------------------------------------------------------------------------
-- The proof: this session has satisfied the second factor.
-- ---------------------------------------------------------------------------
create table if not exists app.mfa_step_up (
  session_id  uuid primary key,
  identity_id uuid not null references app.identity(id) on delete cascade,
  verified_at timestamptz not null default now()
);

-- RLS on with NO policy on all three, the pattern the platform tables use: nothing reaches these
-- tables except through the SECURITY DEFINER functions below. A readable app.mfa_challenge would let
-- a caller compare hashes offline, and a writable app.mfa_step_up would let one skip the factor.
alter table app.mfa_factor    enable row level security;
alter table app.mfa_challenge enable row level security;
alter table app.mfa_step_up   enable row level security;

-- ---------------------------------------------------------------------------
-- What the app needs to know before drawing anything.
-- ---------------------------------------------------------------------------
create or replace function app.mfa_state()
returns table (enabled boolean, channel text, destination text, stepped_up boolean)
language sql stable security definer set search_path = app, pg_temp as $$
  select
    f.identity_id is not null and f.verified_at is not null,
    coalesce(f.channel, 'email'),
    f.destination,
    exists (select 1 from app.mfa_step_up s
             where s.session_id = app.current_session_id()
               and s.identity_id = auth.uid())
  from (select null::uuid) _
  left join app.mfa_factor f on f.identity_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Enrolment, step one: name the destination. Nothing is protected yet.
-- ---------------------------------------------------------------------------
create or replace function app.mfa_enroll_start(p_channel text, p_destination text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_channel <> 'email' then raise exception 'CHANNEL_UNAVAILABLE'; end if;
  if coalesce(p_destination, '') = '' then raise exception 'DESTINATION_REQUIRED'; end if;

  -- Re-starting resets verified_at: a destination that has not proven itself must not inherit the
  -- previous one's trust.
  insert into app.mfa_factor (identity_id, channel, destination)
  values (auth.uid(), p_channel, lower(p_destination))
  on conflict (identity_id) do update
     set channel = excluded.channel,
         destination = excluded.destination,
         verified_at = null,
         updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Issue a challenge. The caller has already generated the code and hashed it.
-- ---------------------------------------------------------------------------
create or replace function app.mfa_challenge_issue(
  p_code_hash text, p_purpose text, p_ttl_seconds int default 600
) returns uuid
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_session uuid := app.current_session_id();
  v_id      uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_session is null then raise exception 'NO_SESSION'; end if;
  if p_purpose not in ('enroll', 'step_up') then raise exception 'BAD_PURPOSE'; end if;
  if coalesce(p_code_hash, '') = '' then raise exception 'CODE_REQUIRED'; end if;

  -- Asking for a new code retires the old one. Otherwise every "resend" would widen the set of
  -- codes that open the account, which is the opposite of what resending is for.
  update app.mfa_challenge
     set consumed_at = now()
   where identity_id = auth.uid()
     and session_id = v_session
     and purpose = p_purpose
     and consumed_at is null;

  insert into app.mfa_challenge (identity_id, session_id, purpose, code_hash, expires_at)
  values (auth.uid(), v_session, p_purpose, p_code_hash,
          now() + make_interval(secs => greatest(least(p_ttl_seconds, 3600), 60)))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verify. Returns a code, not a boolean: the caller needs to tell "wrong" from "expired" from
-- "you have run out of tries", and each deserves a different sentence on screen.
-- ---------------------------------------------------------------------------
create or replace function app.mfa_challenge_verify(p_code_hash text, p_purpose text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_session uuid := app.current_session_id();
  v_row     app.mfa_challenge;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_session is null then raise exception 'NO_SESSION'; end if;

  select * into v_row
    from app.mfa_challenge
   where identity_id = auth.uid()
     and session_id = v_session
     and purpose = p_purpose
     and consumed_at is null
   order by created_at desc
   limit 1
     for update;

  if v_row.id is null then return 'NO_CHALLENGE'; end if;

  if v_row.expires_at <= now() then
    update app.mfa_challenge set consumed_at = now() where id = v_row.id;
    return 'EXPIRED';
  end if;

  -- Counted BEFORE the comparison, so an attempt that crashes mid-way still costs an attempt.
  update app.mfa_challenge set attempts = attempts + 1 where id = v_row.id
    returning attempts into v_row.attempts;

  if v_row.attempts > v_row.max_attempts then
    update app.mfa_challenge set consumed_at = now() where id = v_row.id;
    return 'TOO_MANY_ATTEMPTS';
  end if;

  -- Both sides are hex digests of fixed width, so this comparison leaks nothing useful about the
  -- code itself; the attempt counter above is what actually bounds guessing.
  if v_row.code_hash <> p_code_hash then return 'BAD_CODE'; end if;

  update app.mfa_challenge set consumed_at = now() where id = v_row.id;

  if p_purpose = 'enroll' then
    update app.mfa_factor set verified_at = now(), updated_at = now() where identity_id = auth.uid();
  end if;

  -- Enrolment counts as step-up too: the user has just proven the destination in this very session,
  -- and bouncing them to a challenge screen immediately afterwards would only look broken.
  insert into app.mfa_step_up (session_id, identity_id)
  values (v_session, auth.uid())
  on conflict (session_id) do update set verified_at = now();

  return 'OK';
end;
$$;

-- ---------------------------------------------------------------------------
-- Turn it off. Only from a session that has just proven the factor — otherwise a stolen password
-- alone would be enough to remove the thing that stands in the way of a stolen password.
-- ---------------------------------------------------------------------------
create or replace function app.mfa_disable() returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from app.mfa_step_up
                  where session_id = app.current_session_id() and identity_id = auth.uid())
  then raise exception 'STEP_UP_REQUIRED'; end if;

  delete from app.mfa_factor  where identity_id = auth.uid();
  delete from app.mfa_step_up where identity_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping, from the daily cron alongside app.rate_limit_sweep().
-- Spent challenges are noise; step-up rows outlive the sessions they describe and would otherwise
-- accumulate one row per sign-in forever.
-- ---------------------------------------------------------------------------
create or replace function app.mfa_sweep() returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_deleted int;
begin
  delete from app.mfa_challenge where created_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  -- 30 days matches GoTrue's default refresh-token lifetime: past it the session it belongs to
  -- cannot exist any more.
  delete from app.mfa_step_up where verified_at < now() - interval '30 days';
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — the 0053 rule: 0001 grants execute on app functions to anon and authenticated by
-- default privilege, so `revoke from public` alone closes nothing. Every function is revoked BY NAME
-- from anon and authenticated first, then granted back only where a signed-in caller must reach it.
-- ---------------------------------------------------------------------------
revoke all on function app.current_session_id()                     from public, anon, authenticated;
revoke all on function app.mfa_state()                              from public, anon, authenticated;
revoke all on function app.mfa_enroll_start(text, text)             from public, anon, authenticated;
revoke all on function app.mfa_challenge_issue(text, text, int)     from public, anon, authenticated;
revoke all on function app.mfa_challenge_verify(text, text)         from public, anon, authenticated;
revoke all on function app.mfa_disable()                            from public, anon, authenticated;
revoke all on function app.mfa_sweep()                              from public, anon, authenticated;

-- The five a signed-in user drives themselves. Each derives BOTH the identity and the session from
-- the verified JWT, so "authenticated" can only ever act on its own account.
grant execute on function app.mfa_state()                          to authenticated, service_role;
grant execute on function app.mfa_enroll_start(text, text)         to authenticated, service_role;
grant execute on function app.mfa_challenge_issue(text, text, int) to authenticated, service_role;
grant execute on function app.mfa_challenge_verify(text, text)     to authenticated, service_role;
grant execute on function app.mfa_disable()                        to authenticated, service_role;
-- Not app-facing: a helper the functions above call internally, and a cron job.
grant execute on function app.current_session_id()                 to service_role;
grant execute on function app.mfa_sweep()                          to service_role;

select app.record_migration('0069', '0069_email_mfa');
