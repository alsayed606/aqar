-- 0070_mfa_recovery.sql
-- مخرجان لمن فقد وسيلة التحقّق: رموز احتياطية يحفظها بنفسه، ورمز يصل بريده.
--
-- WHY THIS EXISTS
-- 0069 gave the account a second factor and no way back. Read the three rules together and the trap
-- is exact: middleware sends every aal1 session to /auth/mfa, that screen accepts nothing but the
-- factor, and removing the factor (GoTrue's unenroll, our app.mfa_disable) demands the very proof
-- the user has lost. A dropped phone was therefore a dead account — no support path, no reset, and
-- nothing in the product that said so.
--
-- TWO EXITS, AND THEY ARE NOT EQUAL
--   1. RECOVERY CODES — ten strings of fifty random bits, shown once, hashed here, single-use. The
--      user holds them offline, so they survive a lost phone, a wiped authenticator, a drifted
--      clock and a dead mailbox alike. Nothing about them is weaker than the factor they replace,
--      so consuming one is a FULL step-up.
--   2. AN E-MAIL CODE (purpose 'recovery') — the fallback for someone who saved no codes. It is
--      strictly weaker than TOTP: whoever reads that inbox can already reset the password. So it
--      does NOT hand over the app. It opens a RESTRICTED session that can reach the security page
--      and nothing else — enough to remove the lost factor or enrol a new one, which is all
--      recovery ever needed to mean.
--
-- That distinction is the whole point of the `method` column below. Without it the weaker exit
-- would silently become the account's real security level, and every authenticator app in the
-- product would be decoration.

-- ---------------------------------------------------------------------------
-- How this session proved itself.
-- ---------------------------------------------------------------------------
-- 'factor'         — the code from the enrolled destination or the authenticator app.
-- 'recovery_code'  — one of the ten. Equal standing on purpose.
-- 'email_fallback' — the weaker exit. Restricted, and the app reads this to know it.
alter table app.mfa_step_up
  add column if not exists method text not null default 'factor';

do $$ begin
  alter table app.mfa_step_up
    add constraint mfa_step_up_method_check
    check (method in ('factor', 'recovery_code', 'email_fallback'));
exception when duplicate_object then null; end $$;

-- 'recovery' joins the purposes a challenge may carry. Kept as its own purpose rather than reusing
-- 'step_up' so an ordinary step-up code can never be spent to open a restricted recovery session,
-- nor the reverse — the verify function reads the purpose to decide which method it grants.
alter table app.mfa_challenge drop constraint if exists mfa_challenge_purpose_check;
alter table app.mfa_challenge
  add constraint mfa_challenge_purpose_check
  check (purpose in ('enroll', 'step_up', 'recovery'));

-- ---------------------------------------------------------------------------
-- The ten codes.
-- ---------------------------------------------------------------------------
create table if not exists app.mfa_recovery_code (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references app.identity(id) on delete cascade,
  -- Hashed, never the code. Same discipline as app.mfa_challenge: a dump yields digests. The hash
  -- is fast (sha256, salted with the account id in the app) and that is deliberate — fifty bits of
  -- entropy is not brute-forced through a rate-limited RPC, so a slow KDF here would buy nothing
  -- and cost every sign-in.
  code_hash    text not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  -- The same code twice for one person would be a code with two lives.
  unique (identity_id, code_hash)
);

-- Consumption looks up exactly this: my unused codes.
create index if not exists mfa_recovery_code_open_idx
  on app.mfa_recovery_code (identity_id) where used_at is null;

-- RLS on, no policy — the 0069 pattern. A readable table would publish the hashes to compare
-- offline; a writable one would let a caller mint their own way in.
alter table app.mfa_recovery_code enable row level security;

-- ---------------------------------------------------------------------------
-- "Has this session proved a real factor?"
-- ---------------------------------------------------------------------------
-- Issuing codes must not be reachable from a password alone, otherwise whoever stole the password
-- prints themselves a permanent key. Two things count as proof, and the first cannot live in our
-- tables: GoTrue's TOTP step-up is recorded only in the token, as the `aal` claim. Reading the claim
-- is safe for the same reason session_id is — it comes from the JWT PostgREST already verified.
--
-- 'email_fallback' is excluded by name. A restricted session exists to REMOVE a factor, never to
-- print new keys to the account.
create or replace function app.mfa_proved() returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2'
      or exists (
           select 1 from app.mfa_step_up s
            where s.session_id = app.current_session_id()
              and s.identity_id = auth.uid()
              and s.method in ('factor', 'recovery_code'));
$$;

-- ---------------------------------------------------------------------------
-- What the app needs to know before drawing anything (0069's function, widened).
-- ---------------------------------------------------------------------------
-- Two columns are added, so the signature changes and the old one must go first.
--   codes_left     — drawn in the UI, and the reason a user is warned BEFORE the last one is spent.
--   step_up_method — how this session got in. The middleware confines the restricted kind.
drop function if exists app.mfa_state();
create function app.mfa_state()
returns table (
  enabled boolean, channel text, destination text, stepped_up boolean,
  step_up_method text, codes_left int
)
language sql stable security definer set search_path = app, pg_temp as $$
  select
    f.identity_id is not null and f.verified_at is not null,
    coalesce(f.channel, 'email'),
    f.destination,
    s.session_id is not null,
    s.method,
    (select count(*)::int from app.mfa_recovery_code r
      where r.identity_id = auth.uid() and r.used_at is null)
  from (select null::uuid) _
  left join app.mfa_factor f on f.identity_id = auth.uid()
  left join app.mfa_step_up s on s.session_id = app.current_session_id()
                             and s.identity_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Issue a fresh set. Replaces whatever was there.
-- ---------------------------------------------------------------------------
-- Replacement, not addition: a set the user has half-lost track of must stop working the moment
-- they print a new one, and "add ten more" would leave the old sheet valid forever.
create or replace function app.mfa_recovery_generate(p_hashes text[]) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not app.mfa_proved() then raise exception 'STEP_UP_REQUIRED'; end if;

  -- A bound, because the array arrives from the client. Ten is what the app sends.
  v_count := coalesce(array_length(p_hashes, 1), 0);
  if v_count < 1 or v_count > 20 then raise exception 'BAD_CODE_SET'; end if;
  if exists (select 1 from unnest(p_hashes) h where coalesce(h, '') = '') then
    raise exception 'BAD_CODE_SET';
  end if;
  -- Duplicates inside one set would mean fewer real codes than the screen promises.
  if (select count(distinct h) from unnest(p_hashes) h) <> v_count then
    raise exception 'BAD_CODE_SET';
  end if;

  delete from app.mfa_recovery_code where identity_id = auth.uid();
  insert into app.mfa_recovery_code (identity_id, code_hash)
  select auth.uid(), h from unnest(p_hashes) h;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spend one.
-- ---------------------------------------------------------------------------
-- Deliberately requires NO prior proof: this is the door for someone who has none. What bounds it
-- is the app's rate limit plus the fifty bits in the code itself.
create or replace function app.mfa_recovery_consume(p_code_hash text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_session uuid := app.current_session_id();
  v_id      uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_session is null then raise exception 'NO_SESSION'; end if;
  if coalesce(p_code_hash, '') = '' then return 'BAD_CODE'; end if;

  -- `for update` because two tabs submitting the same code must spend it once, not twice.
  select id into v_id
    from app.mfa_recovery_code
   where identity_id = auth.uid() and code_hash = p_code_hash and used_at is null
   for update;

  -- One verdict for "wrong code" and for "already spent". Telling them apart would confirm to an
  -- attacker that a guessed code was real, which is most of the work of guessing it.
  if v_id is null then return 'BAD_CODE'; end if;

  update app.mfa_recovery_code set used_at = now() where id = v_id;

  -- Full standing: a code the user stored offline is not a weaker proof than the phone they lost.
  insert into app.mfa_step_up (session_id, identity_id, method)
  values (v_session, auth.uid(), 'recovery_code')
  on conflict (session_id) do update set verified_at = now(), method = 'recovery_code';

  return 'OK';
end;
$$;

-- ---------------------------------------------------------------------------
-- Verify (0069's function, taught the third purpose).
-- ---------------------------------------------------------------------------
create or replace function app.mfa_challenge_verify(p_code_hash text, p_purpose text) returns text
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_session uuid := app.current_session_id();
  v_row     app.mfa_challenge;
  v_method  text;
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

  if v_row.code_hash <> p_code_hash then return 'BAD_CODE'; end if;

  update app.mfa_challenge set consumed_at = now() where id = v_row.id;

  if p_purpose = 'enroll' then
    update app.mfa_factor set verified_at = now(), updated_at = now() where identity_id = auth.uid();
  end if;

  -- The purpose decides the standing. 'recovery' is the weaker exit and is marked as such here,
  -- once, rather than trusted to be re-derived correctly at every gate that reads it.
  v_method := case when p_purpose = 'recovery' then 'email_fallback' else 'factor' end;

  insert into app.mfa_step_up (session_id, identity_id, method)
  values (v_session, auth.uid(), v_method)
  on conflict (session_id) do update
    -- A restricted session that then proves the real factor is promoted; the reverse must never
    -- happen, or an e-mail code would quietly demote a session that had already earned full access
    -- and, worse, a promotion could be undone by re-sending a recovery mail.
    set verified_at = now(),
        method = case when app.mfa_step_up.method = 'factor' then 'factor' else excluded.method end;

  return 'OK';
end;
$$;

-- ---------------------------------------------------------------------------
-- Issue (0069's function, taught the third purpose).
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
  if p_purpose not in ('enroll', 'step_up', 'recovery') then raise exception 'BAD_PURPOSE'; end if;
  if coalesce(p_code_hash, '') = '' then raise exception 'CODE_REQUIRED'; end if;

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
-- Turn it off (0069's function, plus the codes).
-- ---------------------------------------------------------------------------
-- Codes outliving the factor they were printed for would be keys to a door that no longer exists —
-- and would silently re-arm as a way in the moment a new factor is enrolled.
create or replace function app.mfa_disable() returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from app.mfa_step_up
                  where session_id = app.current_session_id() and identity_id = auth.uid())
  then raise exception 'STEP_UP_REQUIRED'; end if;

  delete from app.mfa_factor        where identity_id = auth.uid();
  delete from app.mfa_recovery_code where identity_id = auth.uid();
  delete from app.mfa_step_up       where identity_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- End the restricted session.
-- ---------------------------------------------------------------------------
-- Called once the lost factor has actually been removed. The restriction is a consequence of
-- holding weak proof, so it is dropped by dropping the proof — not by a flag saying to ignore it.
-- What the user gets afterwards is whatever their account now requires: nothing, if they removed
-- everything; a fresh challenge, if a factor remains. Both are correct, and neither is "let them
-- through because they tried".
create or replace function app.mfa_recovery_finish() returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  -- Only the weak kind. A session that proved the real factor must not be able to talk itself out
  -- of its own step-up record.
  delete from app.mfa_step_up
   where session_id = app.current_session_id()
     and identity_id = auth.uid()
     and method = 'email_fallback';
end;
$$;

-- Spent codes are NOT swept. Ten rows per account is nothing, and "which code was used, and when"
-- is exactly the trail an owner asking "was that me?" needs to follow.

-- ---------------------------------------------------------------------------
-- Grants — the 0053 rule: revoke by name first, then grant back only what a signed-in caller drives.
-- ---------------------------------------------------------------------------
revoke all on function app.mfa_state()                          from public, anon, authenticated;
revoke all on function app.mfa_proved()                         from public, anon, authenticated;
revoke all on function app.mfa_recovery_generate(text[])        from public, anon, authenticated;
revoke all on function app.mfa_recovery_consume(text)           from public, anon, authenticated;
revoke all on function app.mfa_challenge_verify(text, text)     from public, anon, authenticated;
revoke all on function app.mfa_challenge_issue(text, text, int) from public, anon, authenticated;
revoke all on function app.mfa_disable()                        from public, anon, authenticated;
revoke all on function app.mfa_recovery_finish()                from public, anon, authenticated;

grant execute on function app.mfa_state()                          to authenticated, service_role;
grant execute on function app.mfa_recovery_generate(text[])        to authenticated, service_role;
grant execute on function app.mfa_recovery_consume(text)           to authenticated, service_role;
grant execute on function app.mfa_challenge_verify(text, text)     to authenticated, service_role;
grant execute on function app.mfa_challenge_issue(text, text, int) to authenticated, service_role;
grant execute on function app.mfa_disable()                        to authenticated, service_role;
grant execute on function app.mfa_recovery_finish()                to authenticated, service_role;
-- Not app-facing: a predicate the functions above call internally.
grant execute on function app.mfa_proved()                         to service_role;

select app.record_migration('0070', '0070_mfa_recovery');
