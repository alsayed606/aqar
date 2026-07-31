-- 0054_platform_settings_flags_broadcast.sql
-- Sprint T-5 — platform settings, feature flags, and the broadcast centre.
--
-- SETTINGS. What the brief calls "platform settings" splits cleanly in two, and only one half
-- belongs in a database. Provider keys — Resend, Moyasar, CRON_SECRET, the Supabase service key —
-- are ENVIRONMENT, and a console that can read or write them turns one compromised operator account
-- into a compromised payment account. They stay in env, and the settings page reports only whether
-- each is CONFIGURED, never its value. What lives here is the handful of numbers and strings that
-- currently require a migration to change: the trial length, the plan a new office starts on, and
-- the support contact shown to customers.
--
-- FLAGS. app.feature_flag (0005) is per-org and has no global tier, so "turn this on for everyone"
-- and "turn it on for 10% of offices" were not expressible. app.platform_flag adds that tier, and
-- app.feature_enabled(org, key) resolves the two in a fixed order. The percentage rollout hashes the
-- org and the key together so an office's answer never changes between calls, and two different
-- flags at 10% do not select the same 10% of offices.
--
-- BROADCAST. Sending to every customer at once is the least reversible thing in this console, so the
-- function is built around finding out first: p_dry_run counts the audience and writes nothing. The
-- send itself reuses the existing notification + delivery outbox and the drainer cron, so a
-- broadcast is delivered by exactly the same machinery as every other email and can be watched on
-- the health page.

-- ---------------------------------------------------------------------------
-- platform_setting — one row per knob. Platform-only (RLS on, no policy).
-- ---------------------------------------------------------------------------
create table if not exists app.platform_setting (
  key         text primary key,
  value       jsonb not null,
  label_ar    text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table app.platform_setting enable row level security;

insert into app.platform_setting (key, value, label_ar) values
  ('trial_days',      '30'::jsonb,                    'مدة التجربة (أيام)'),
  ('default_plan',    '"basic"'::jsonb,               'خطة البداية للمكاتب الجديدة'),
  ('support_email',   '"info@6n1.io"'::jsonb,         'بريد الدعم المعروض للعملاء'),
  ('support_phone',   '""'::jsonb,                    'جوال الدعم المعروض للعملاء'),
  ('broadcast_from',  '"عقار"'::jsonb,                'اسم المُرسِل في رسائل البثّ')
on conflict (key) do nothing;  -- re-running must never reset a value the operator has changed

-- Internal reader. Not operator-gated: it is called from inside other SECURITY DEFINER functions
-- (org provisioning), never exposed on its own.
create or replace function app.setting(p_key text, p_default jsonb default null) returns jsonb
language sql stable security definer set search_path = app, pg_temp as $$
  select coalesce((select value from app.platform_setting where key = p_key), p_default);
$$;

create or replace function app.platform_settings()
returns table (key text, value jsonb, label_ar text, updated_at timestamptz)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query select s.key, s.value, s.label_ar, s.updated_at from app.platform_setting s order by s.key;
end;
$$;

create or replace function app.operator_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_before jsonb;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select value into v_before from app.platform_setting where key = p_key;
  if v_before is null then
    -- Only known keys. An open key-value store invites settings nothing reads.
    raise exception 'UNKNOWN_SETTING' using errcode = 'raise_exception';
  end if;
  if p_key = 'trial_days' and (jsonb_typeof(p_value) <> 'number'
       or (p_value)::text::int < 0 or (p_value)::text::int > 365) then
    raise exception 'INVALID_SETTING' using errcode = 'raise_exception';
  end if;
  if p_key = 'default_plan' and not exists (select 1 from app.plan where code = p_value #>> '{}') then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  update app.platform_setting
     set value = p_value, updated_at = now(), updated_by = auth.uid()
   where key = p_key;

  perform app.write_audit(null, 'platform.setting_update', 'platform_setting', null,
    jsonb_build_object('key', p_key, 'before', v_before, 'after', p_value));
end;
$$;

-- New offices now start on the CONFIGURED plan for the CONFIGURED number of days. Otherwise this is
-- the 0044 definition unchanged — same default org_type, same one-org guard, same message — because
-- only the two literals were meant to move.
create or replace function app.create_organization(
  p_name text, p_org_type app.org_type default 'management_office'
) returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_org   uuid;
  v_party uuid;
  v_me    uuid := auth.uid();
  v_plan  text := coalesce(app.setting('default_plan') #>> '{}', 'basic');
  v_days  int  := coalesce((app.setting('trial_days') #>> '{}')::int, 30);
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;
  if exists (
    select 1 from app.membership m
    where m.identity_id = v_me and m.role = 'owner' and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'OWN_ORG_EXISTS: a user can create only one organization' using errcode = 'raise_exception';
  end if;

  insert into app.organization (name, org_type) values (p_name, p_org_type) returning id into v_org;

  -- Trial on the starting tier (ق-ب): full-value evaluation, then a hard lock on expiry.
  insert into app.org_subscription (org_id, plan_code, status, trial_ends_at)
  values (v_org, v_plan, 'trialing', now() + make_interval(days => v_days));

  insert into app.membership (identity_id, org_id, role, status, scope_all)
  values (v_me, v_org, 'owner', 'active', true);

  -- Self-owner: the org owning itself. A party with NO identity link (an entity, not a person).
  insert into app.party (org_id, display_name, legal_kind, roles)
  values (v_org, p_name, 'company', array['owner']::app.party_role[])
  returning id into v_party;

  insert into app.owner (org_id, party_id, is_self, owner_kind)
  values (v_org, v_party, true, 'company');

  perform app.write_audit(v_org, 'org.create', 'organization', v_org,
                          jsonb_build_object('name', p_name, 'org_type', p_org_type,
                                             'plan', v_plan, 'trial_days', v_days));
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_flag — the global tier above the per-org app.feature_flag (0005).
-- ---------------------------------------------------------------------------
create table if not exists app.platform_flag (
  key             text primary key,
  label_ar        text not null,
  description     text,
  is_enabled      boolean not null default false,   -- the default answer for every org
  rollout_percent int not null default 0 check (rollout_percent between 0 and 100),
  required_plan   text references app.plan(code),   -- gate by tier; NULL = every plan
  is_beta         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table app.platform_flag enable row level security;

-- feature_enabled(org, key) — resolution order, first answer wins:
--   1. a per-org row in app.feature_flag  → an explicit decision for THIS office, on or off
--   2. no global flag at all              → false (unknown features are off, never on)
--   3. the plan gate                      → below the required tier is off regardless of the rest
--   4. is_enabled                         → on for everyone
--   5. rollout_percent                    → a stable slice, hashed from the org AND the key so an
--      office's answer never flips between calls and two flags at 10% pick different offices
create or replace function app.feature_enabled(p_org uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare
  v_override boolean;
  f          app.platform_flag;
  v_bucket   int;
begin
  -- The app asks this for the office the caller is in; the console asks it for any office. Nobody
  -- else gets to probe another org's feature state (0053: a reachable function needs its own gate).
  if not (app.has_org_access(p_org) or app.is_platform_operator()) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select is_enabled into v_override from app.feature_flag where org_id = p_org and key = p_key;
  if v_override is not null then
    return v_override;
  end if;

  select * into f from app.platform_flag where key = p_key;
  if f.key is null then
    return false;
  end if;

  if f.required_plan is not null then
    if not exists (
      select 1 from app.org_subscription s
        join app.plan have on have.code = s.plan_code
        join app.plan need on need.code = f.required_plan
       where s.org_id = p_org and have.sort >= need.sort
    ) then
      return false;
    end if;
  end if;

  if f.is_enabled then
    return true;
  end if;
  if f.rollout_percent <= 0 then
    return false;
  end if;

  v_bucket := ('x' || substr(md5(p_org::text || ':' || p_key), 1, 8))::bit(32)::bigint % 100;
  return v_bucket < f.rollout_percent;
end;
$$;

create or replace function app.platform_list_flags()
returns table (key text, label_ar text, description text, is_enabled boolean,
               rollout_percent int, required_plan text, is_beta boolean,
               overrides_on int, overrides_off int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select f.key, f.label_ar, f.description, f.is_enabled, f.rollout_percent, f.required_plan, f.is_beta,
           (select count(*)::int from app.feature_flag o where o.key = f.key and o.is_enabled),
           (select count(*)::int from app.feature_flag o where o.key = f.key and not o.is_enabled)
      from app.platform_flag f
     order by f.is_beta, f.key;
end;
$$;

create or replace function app.operator_set_flag(
  p_key text, p_label_ar text, p_description text default null,
  p_is_enabled boolean default false, p_rollout_percent int default 0,
  p_required_plan text default null, p_is_beta boolean default false
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_before app.platform_flag;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_key !~ '^[a-z][a-z0-9_]{1,49}$' then
    raise exception 'INVALID_FLAG_KEY' using errcode = 'raise_exception';
  end if;
  if coalesce(p_rollout_percent, 0) < 0 or coalesce(p_rollout_percent, 0) > 100 then
    raise exception 'INVALID_ROLLOUT' using errcode = 'raise_exception';
  end if;
  if p_required_plan is not null and not exists (select 1 from app.plan where code = p_required_plan) then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  select * into v_before from app.platform_flag where key = p_key;

  insert into app.platform_flag (key, label_ar, description, is_enabled, rollout_percent, required_plan, is_beta)
  values (p_key, btrim(p_label_ar), nullif(btrim(coalesce(p_description, '')), ''),
          coalesce(p_is_enabled, false), coalesce(p_rollout_percent, 0), p_required_plan, coalesce(p_is_beta, false))
  on conflict (key) do update set
    label_ar = excluded.label_ar, description = excluded.description,
    is_enabled = excluded.is_enabled, rollout_percent = excluded.rollout_percent,
    required_plan = excluded.required_plan, is_beta = excluded.is_beta, updated_at = now();

  perform app.write_audit(null, 'platform.flag_update', 'platform_flag', null, jsonb_build_object(
    'key', p_key,
    'before', case when v_before.key is null then null else jsonb_build_object(
      'is_enabled', v_before.is_enabled, 'rollout_percent', v_before.rollout_percent,
      'required_plan', v_before.required_plan) end,
    'after', jsonb_build_object(
      'is_enabled', coalesce(p_is_enabled, false), 'rollout_percent', coalesce(p_rollout_percent, 0),
      'required_plan', p_required_plan)));
end;
$$;

-- ---------------------------------------------------------------------------
-- broadcast — history of what was sent to whom.
-- ---------------------------------------------------------------------------
create table if not exists app.broadcast (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text,
  audience     jsonb not null default '{}'::jsonb,
  channel      text not null check (channel in ('in_app', 'in_app_email')),
  orgs_count   int not null default 0,
  emails_count int not null default 0,
  sent_by      uuid,
  sent_at      timestamptz not null default now()
);

alter table app.broadcast enable row level security;

-- platform_broadcast(...) — p_dry_run counts the audience and writes NOTHING. The console calls it
-- that way first and shows the number before anything can be sent: this is the least reversible
-- action in the product.
--
-- Audience keys: {} = every live office; {"status": "..."} ; {"plan": "..."} ; {"orgs": [uuid, ...]}.
create or replace function app.platform_broadcast(
  p_title text,
  p_body text default null,
  p_audience jsonb default '{}'::jsonb,
  p_channel text default 'in_app',
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_status text := p_audience->>'status';
  v_plan   text := p_audience->>'plan';
  v_orgs   uuid[];
  v_ids    uuid[];
  v_emails int := 0;
  v_id     uuid;
  v_note   uuid;
  v_bid    uuid;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'raise_exception';
  end if;
  if p_channel not in ('in_app', 'in_app_email') then
    raise exception 'INVALID_CHANNEL' using errcode = 'raise_exception';
  end if;

  if p_audience ? 'orgs' then
    select array_agg(value::text::uuid) into v_orgs from jsonb_array_elements(p_audience->'orgs');
  end if;

  select array_agg(o.id) into v_ids
    from app.organization o
    left join app.org_subscription s on s.org_id = o.id
   where o.deleted_at is null
     and (v_status is null or s.status::text = v_status)
     and (v_plan   is null or s.plan_code = v_plan)
     and (v_orgs   is null or o.id = any(v_orgs));

  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- Count the mailboxes the same way the outbox will resolve them, so the number shown before
  -- sending is the number that actually receives it.
  if p_channel = 'in_app_email' then
    select count(*)::int into v_emails
      from app.membership m
      join app.identity i on i.id = m.identity_id and i.email is not null and i.status = 'active'
     where m.org_id = any(v_ids) and m.status = 'active' and m.deleted_at is null;
  end if;

  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'orgs', cardinality(v_ids), 'emails', v_emails);
  end if;

  insert into app.broadcast (title, body, audience, channel, orgs_count, emails_count, sent_by)
  values (btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), coalesce(p_audience, '{}'::jsonb),
          p_channel, cardinality(v_ids), v_emails, auth.uid())
  returning id into v_bid;

  foreach v_id in array v_ids loop
    insert into app.notification (org_id, kind, title, body, entity_type, entity_id)
    values (v_id, 'platform_broadcast', btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), 'broadcast', v_bid)
    returning id into v_note;
    if p_channel = 'in_app_email' then
      perform app.enqueue_notification_email(v_note);
    end if;
  end loop;

  perform app.write_audit(null, 'platform.broadcast', 'broadcast', v_bid, jsonb_build_object(
    'title', btrim(p_title), 'channel', p_channel, 'audience', p_audience,
    'orgs', cardinality(v_ids), 'emails', v_emails));

  return jsonb_build_object('dry_run', false, 'broadcast_id', v_bid,
                            'orgs', cardinality(v_ids), 'emails', v_emails);
end;
$$;

create or replace function app.platform_list_broadcasts(p_limit int default 20)
returns setof app.broadcast
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query select * from app.broadcast order by sent_at desc limit greatest(p_limit, 1);
end;
$$;

-- Grants. app.setting() has no internal gate — it is an internal helper — so it must revoke from the
-- roles the default privileges granted (0053).
revoke all on function app.setting(text, jsonb) from public, anon, authenticated;
grant execute on function app.setting(text, jsonb) to service_role;

revoke all on function app.platform_settings()                              from public;
revoke all on function app.operator_set_setting(text, jsonb)                from public;
revoke all on function app.feature_enabled(uuid, text)                      from public;
revoke all on function app.platform_list_flags()                            from public;
revoke all on function app.operator_set_flag(text, text, text, boolean, int, text, boolean) from public;
revoke all on function app.platform_broadcast(text, text, jsonb, text, boolean) from public;
revoke all on function app.platform_list_broadcasts(int)                    from public;
grant execute on function app.platform_settings()                           to authenticated, service_role;
grant execute on function app.operator_set_setting(text, jsonb)             to authenticated, service_role;
grant execute on function app.feature_enabled(uuid, text)                   to authenticated, service_role;
grant execute on function app.platform_list_flags()                         to authenticated, service_role;
grant execute on function app.operator_set_flag(text, text, text, boolean, int, text, boolean) to authenticated, service_role;
grant execute on function app.platform_broadcast(text, text, jsonb, text, boolean) to authenticated, service_role;
grant execute on function app.platform_list_broadcasts(int)                 to authenticated, service_role;
