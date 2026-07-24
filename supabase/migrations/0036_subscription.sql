-- 0036_subscription.sql
-- Sprint D: the SaaS subscription model — manual (invoice-based) billing. This migration owns the
-- PLAN CATALOG, the per-org SUBSCRIPTION record, and DB-level ENFORCEMENT of two rules:
--   1. Liveness lock (Charter ق-ب): a 30-day trial then a HARD LOCK on new business creation.
--   2. Plan limits (Charter ق-هـ): a HARD block when a create would exceed the plan's ceiling.
-- Both block NEW rows only — existing data stays fully readable and editable (ق-هـ).
--
-- Administration is intentionally SQL/service_role only (ق-د): there is no self-serve write surface
-- and no payment gateway here. Two manual marketing levers are supported by the schema:
--   • extend a trial  -> UPDATE org_subscription SET trial_ends_at = trial_ends_at + interval '…'.
--   • grant a comp     -> UPDATE org_subscription SET status = 'comped' (bypasses expiry entirely).
-- Idempotent; safe on the live DB and on a fresh build.

-- ---------------------------------------------------------------------------
-- plan — the price/limit catalog. Limits are DATA (NULL = unlimited); tuning them needs no migration.
-- Trial is NOT a plan: it is a `trialing` status on a real plan (ق-ب grants Basic limits for 30 days).
-- ---------------------------------------------------------------------------
create table if not exists app.plan (
  code           text primary key,           -- basic | pro | enterprise
  name_ar        text not null,
  max_properties int,                         -- NULL = unlimited
  max_units      int,
  max_members    int,
  price_halalas  bigint not null default 0,   -- monthly list price (SAR*100); 0 = custom/contact
  is_public      boolean not null default true,
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Seed the three public tiers (Charter ق-أ). `do update` keeps re-apply idempotent and lets a later
-- migration re-tune numbers by editing this seed. Prices are halalas: 9900 = 99 SAR, 29900 = 299 SAR.
insert into app.plan (code, name_ar, max_properties, max_units, max_members, price_halalas, is_public, sort) values
  ('basic',      'الأساسية',    25,   150,  3,    9900,  true,  1),
  ('pro',        'الاحترافية',  100,  500,  10,   29900, true,  2),
  ('enterprise', 'المؤسسية',    null, null, null, 0,     false, 3)
on conflict (code) do update set
  name_ar        = excluded.name_ar,
  max_properties = excluded.max_properties,
  max_units      = excluded.max_units,
  max_members    = excluded.max_members,
  price_halalas  = excluded.price_halalas,
  is_public      = excluded.is_public,
  sort           = excluded.sort;

-- ---------------------------------------------------------------------------
-- subscription lifecycle. `comped` = a marketing/partner grant that ignores expiry dates entirely.
-- `past_due`/`canceled` exist for future dunning; today they simply read as "not active" → locked.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_status' and typnamespace = 'app'::regnamespace) then
    create type app.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'comped');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- org_subscription — exactly one row per org. Managed by SQL/service_role only (no write grant).
-- ---------------------------------------------------------------------------
create table if not exists app.org_subscription (
  org_id             uuid primary key references app.organization(id) on delete cascade,
  plan_code          text not null references app.plan(code),
  status             app.subscription_status not null default 'trialing',
  trial_ends_at      timestamptz,             -- meaningful while status = 'trialing'
  current_period_end timestamptz,             -- meaningful while status = 'active'; NULL = open-ended
  notes              text,                    -- e.g. the reason for a comp / partner name
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger org_subscription_set_updated_at before update on app.org_subscription
  for each row execute function app.set_updated_at();

alter table app.plan             enable row level security;
alter table app.org_subscription enable row level security;

-- plan is a public catalog (needed to render pricing/usage). Read-only to members; no write surface.
grant select on app.plan to authenticated;
drop policy if exists plan_select on app.plan;
create policy plan_select on app.plan for select using (true);

-- A member reads only their own org's subscription. All writes go through SQL/service_role.
grant select on app.org_subscription to authenticated;
drop policy if exists org_subscription_select on app.org_subscription;
create policy org_subscription_select on app.org_subscription for select
  using (app.has_org_access(org_id));

-- ---------------------------------------------------------------------------
-- Read helpers (SECURITY DEFINER → count true org-wide totals regardless of the caller's row scope).
-- ---------------------------------------------------------------------------

-- subscription_active(org) — is the org entitled to create new business right now?
-- `comped` is always live; a trial is live until trial_ends_at; an active sub until current_period_end
-- (NULL = open-ended). No row (should not happen post-backfill) → false = fail closed.
create or replace function app.subscription_active(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.org_subscription s
    where s.org_id = p_org
      and (
        s.status = 'comped'
        or (s.status = 'trialing' and (s.trial_ends_at is null      or s.trial_ends_at > now()))
        or (s.status = 'active'   and (s.current_period_end is null or s.current_period_end > now()))
      )
  );
$$;

-- plan_limit(org, resource) — the org's plan ceiling for one metered resource; NULL = unlimited.
create or replace function app.plan_limit(p_org uuid, p_resource text) returns int
language sql stable security definer set search_path = app, pg_temp as $$
  select case p_resource
           when 'properties' then pl.max_properties
           when 'units'      then pl.max_units
           when 'members'    then pl.max_members
         end
  from app.org_subscription s
  join app.plan pl on pl.code = s.plan_code
  where s.org_id = p_org;
$$;

-- usage_count(org, resource) — current live count of a metered resource.
create or replace function app.usage_count(p_org uuid, p_resource text) returns int
language sql stable security definer set search_path = app, pg_temp as $$
  select case p_resource
    when 'properties' then (select count(*)::int from app.property   where org_id = p_org and deleted_at is null)
    when 'units'      then (select count(*)::int from app.unit       where org_id = p_org and deleted_at is null)
    when 'members'    then (select count(*)::int from app.membership  where org_id = p_org and status = 'active' and deleted_at is null)
    else 0
  end;
$$;

-- subscription_summary(org) — one call for the "الاشتراك والاستخدام" page: plan, status, dates,
-- live entitlement, and usage-vs-limits. Gated to members.
create or replace function app.subscription_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare
  v jsonb;
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select jsonb_build_object(
    'plan_code',          s.plan_code,
    'plan_name',          pl.name_ar,
    'price_halalas',      pl.price_halalas,
    'status',             s.status,
    'active',             app.subscription_active(p_org),
    'trial_ends_at',      s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'limits', jsonb_build_object(
      'properties', pl.max_properties, 'units', pl.max_units, 'members', pl.max_members),
    'usage', jsonb_build_object(
      'properties', app.usage_count(p_org, 'properties'),
      'units',      app.usage_count(p_org, 'units'),
      'members',    app.usage_count(p_org, 'members'))
  ) into v
  from app.org_subscription s
  join app.plan pl on pl.code = s.plan_code
  where s.org_id = p_org;
  return v;  -- NULL when the org has no subscription row (pre-backfill / never provisioned)
end;
$$;

revoke all on function app.subscription_active(uuid)        from public;
revoke all on function app.plan_limit(uuid, text)           from public;
revoke all on function app.usage_count(uuid, text)          from public;
revoke all on function app.subscription_summary(uuid)       from public;
grant execute on function app.subscription_active(uuid)  to service_role;
grant execute on function app.plan_limit(uuid, text)     to service_role;
grant execute on function app.usage_count(uuid, text)    to service_role;
grant execute on function app.subscription_summary(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enforcement. BEFORE INSERT on the growth entities: liveness lock (all four) + metered limit
-- (property/unit/membership). SECURITY DEFINER so the check runs above RLS and reads true totals.
-- Blocks INSERT only → existing rows stay editable (ق-هـ).
-- ---------------------------------------------------------------------------
create or replace function app.tg_subscription_guard() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_resource text;
  v_limit    int;
  v_used     int;
begin
  -- 1. Liveness lock. Trial expired (and not comped/active) → no new business.
  if not app.subscription_active(new.org_id) then
    raise exception 'SUBSCRIPTION_EXPIRED: subscription is not active for org %', new.org_id
      using errcode = 'raise_exception';
  end if;

  -- 2. Metered ceiling for the three limited resources.
  v_resource := case tg_table_name
                  when 'property'   then 'properties'
                  when 'unit'       then 'units'
                  when 'membership' then 'members'
                  else null
                end;

  -- accept_invitation re-activates via INSERT ... ON CONFLICT DO UPDATE: the BEFORE INSERT trigger
  -- still fires, but reusing an existing (identity, org) seat is not new growth → skip the ceiling.
  -- The new.identity_id reference lives ONLY in this membership-only branch: PL/pgSQL prepares a
  -- statement's expression lazily, so property/unit inserts never compile it (they have no such field).
  if tg_table_name = 'membership' then
    if exists (select 1 from app.membership m where m.org_id = new.org_id and m.identity_id = new.identity_id) then
      v_resource := null;
    end if;
  end if;

  if v_resource is not null then
    v_limit := app.plan_limit(new.org_id, v_resource);
    if v_limit is not null then
      v_used := app.usage_count(new.org_id, v_resource);
      if v_used >= v_limit then
        raise exception 'PLAN_LIMIT_EXCEEDED: % limit (%) reached for org %', v_resource, v_limit, new.org_id
          using errcode = 'raise_exception';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists subscription_guard on app.property;
create trigger subscription_guard before insert on app.property
  for each row execute function app.tg_subscription_guard();
drop trigger if exists subscription_guard on app.unit;
create trigger subscription_guard before insert on app.unit
  for each row execute function app.tg_subscription_guard();
drop trigger if exists subscription_guard on app.membership;
create trigger subscription_guard before insert on app.membership
  for each row execute function app.tg_subscription_guard();
drop trigger if exists subscription_guard on app.contract;
create trigger subscription_guard before insert on app.contract
  for each row execute function app.tg_subscription_guard();

-- ---------------------------------------------------------------------------
-- create_organization — now also provisions a 30-day Basic trial BEFORE the owner membership is
-- inserted, so the guard passes for the org's very first member. (Replaces the 0013 definition;
-- everything else is unchanged.) §2 / ق-ب.
-- ---------------------------------------------------------------------------
create or replace function app.create_organization(
  p_name text, p_org_type app.org_type default 'management_office'
) returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_org   uuid;
  v_party uuid;
  v_me    uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  insert into app.organization (name, org_type) values (p_name, p_org_type) returning id into v_org;

  -- 30-day trial on the Basic tier (ق-ب): full-value evaluation, then a hard lock on expiry.
  insert into app.org_subscription (org_id, plan_code, status, trial_ends_at)
  values (v_org, 'basic', 'trialing', now() + interval '30 days');

  insert into app.membership (identity_id, org_id, role, status, scope_all)
  values (v_me, v_org, 'owner', 'active', true);

  -- Self-owner: the org owning itself. It is a party with NO identity link (an entity, not a person).
  insert into app.party (org_id, display_name, legal_kind, roles)
  values (v_org, p_name, 'company', array['owner']::app.party_role[])
  returning id into v_party;

  insert into app.owner (org_id, party_id, is_self, owner_kind)
  values (v_org, v_party, true, 'company');

  perform app.write_audit(v_org, 'org.create', 'organization', v_org,
                          jsonb_build_object('name', p_name, 'org_type', p_org_type));
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill. Every pre-existing org gets a `comped` subscription so nothing already live is locked
-- out by this migration (grandfathering). New orgs get their own trial via create_organization above.
-- ---------------------------------------------------------------------------
insert into app.org_subscription (org_id, plan_code, status, notes)
select o.id, 'basic', 'comped', 'grandfathered at migration 0036'
from app.organization o
where not exists (select 1 from app.org_subscription s where s.org_id = o.id);
