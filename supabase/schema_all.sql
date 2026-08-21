-- schema_all.sql — GENERATED from supabase/migrations/*.sql by supabase/build-schema.mjs.
-- SOURCE OF TRUTH = migrations/ (Charter هـ-4). DO NOT EDIT BY HAND; run:
--   node supabase/build-schema.mjs   (or: npm run build:schema)
-- Convenience for one-shot apply (e.g. Supabase SQL Editor). Verified: loads clean on PostgreSQL 17.

-- ================================================================
-- 0001_extensions_roles.sql
-- ================================================================
-- 0001_extensions_roles.sql
-- Extensions, application schema, and the Supabase auth roles.
-- Idempotent so it can run on a bare Postgres (CI / pgTAP) as well as on Supabase.

create schema if not exists app;
-- Extensions live in their own schema (the Supabase convention) so SECURITY DEFINER functions can
-- pin a fixed search_path that includes it, rather than trusting public.
create schema if not exists extensions;

-- pgcrypto: gen_random_bytes(), digest(), crypt(), gen_salt() → schema 'extensions'.
create extension if not exists pgcrypto with schema extensions;
-- citext: case-insensitive, unique e-mail. Kept in public so the citext TYPE resolves in plain DDL.
create extension if not exists citext;

-- Supabase ships these roles; recreate them on bare Postgres so migrations + tests run anywhere.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema app to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Default privileges: the API roles only ever touch tables through RLS. We grant table DML
-- explicitly per table in 0012; here we make sure future objects created by the migration owner
-- are reachable by the executor of SECURITY DEFINER helpers.
alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;

-- ================================================================
-- 0002_enums.sql
-- ================================================================
-- 0002_enums.sql
-- All domain enums live in the app schema. Enums are used only for stable, closed vocabularies.
-- NOTE: org_type is intentionally an enum used for *presentation/config only*. No data-layer
-- branch (RLS policy, trigger, constraint) may read it. See SCHEMA.md §2.

create type app.org_type          as enum ('management_office', 'brokerage', 'owner');

create type app.membership_role    as enum ('owner', 'admin', 'manager', 'accountant', 'staff', 'viewer');
create type app.membership_status  as enum ('invited', 'active', 'suspended', 'revoked');

create type app.auth_method_type   as enum ('phone_otp', 'passkey', 'email', 'sso');

create type app.party_role         as enum ('owner', 'tenant', 'vendor', 'broker');
create type app.legal_kind         as enum ('individual', 'company');

create type app.property_kind      as enum ('residential', 'commercial', 'mixed_use', 'land', 'other');

-- Explicit operational state of a unit. Occupancy over time is computed from UnitStatusHistory,
-- never from this "current" value alone. See SCHEMA.md §7 rule 10.
create type app.unit_status        as enum (
  'vacant',            -- شاغرة
  'rented',            -- مؤجرة
  'reserved',          -- محجوزة
  'under_maintenance', -- تحت الصيانة
  'not_rentable',      -- غير صالحة للتأجير
  'out_of_service'     -- خارج الخدمة
);

create type app.contract_status    as enum ('draft', 'active', 'expired', 'terminated', 'cancelled');
create type app.contract_kind      as enum ('residential', 'commercial');
create type app.payment_frequency  as enum ('monthly', 'quarterly', 'semi_annual', 'annual', 'one_time', 'custom');

-- Charge classification drives VAT treatment; adding it later would mean back-filling history
-- we do not have. See SCHEMA.md §7 rule 2.
create type app.charge_type        as enum (
  'residential_rent',  -- إيجار سكني  (VAT-exempt in KSA)
  'commercial_rent',   -- إيجار تجاري (VAT 15%)
  'service_fee',       -- خدمات
  'insurance',         -- تأمين
  'admin_fee',         -- رسوم إدارية
  'security_deposit'   -- تأمين مسترد (out of VAT scope)
);

create type app.payment_method     as enum ('cash', 'bank_transfer', 'sadad', 'mada', 'apple_pay', 'card', 'cheque', 'other');

create type app.fee_model          as enum ('percentage_of_collection', 'fixed_amount', 'per_unit');

create type app.document_entity    as enum (
  'organization', 'property', 'unit', 'contract', 'management_agreement',
  'owner', 'tenant', 'payment', 'charge'
);

create type app.import_kind        as enum ('properties', 'units', 'owners', 'tenants', 'contracts', 'charges');
create type app.import_status      as enum ('draft', 'validated', 'committed', 'reverted', 'failed');

-- ================================================================
-- 0003_utils.sql
-- ================================================================
-- 0003_utils.sql
-- Table-independent utility functions: auth.uid() shim, normalization (phone / amount / date),
-- and the shared updated_at trigger function. These are pure and IMMUTABLE where possible so they
-- can be used inside CHECK constraints, generated columns, import, and tests alike.

-- ---------------------------------------------------------------------------
-- auth.uid() / auth.role() shim.
-- Supabase already defines these; we (re)define identically so the same SQL runs on bare Postgres.
-- Reads the JWT sub claim from the request GUC. Returns NULL when unauthenticated.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

-- IMPORTANT: On Supabase, auth.uid()/auth.role() already exist and are owned by
-- supabase_auth_admin — we must NOT replace them (permission error + would clobber Supabase Auth).
-- We only install a compatible shim when the function is ABSENT (bare Postgres / CI). Supabase's
-- native versions read the same request.jwt.claims, so behaviour is identical either way.
-- nullif(...,'') BEFORE ::json so an empty GUC ('' vs absent) can never raise "invalid json".
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid' and p.pronargs = 0
  ) then
    execute $fn$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid;
      $body$;
    $fn$;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'role' and p.pronargs = 0
  ) then
    execute $fn$
      create function auth.role() returns text language sql stable as $body$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', 'anon');
      $body$;
    $fn$;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- Digit folding: Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) to ASCII 0-9.
-- ---------------------------------------------------------------------------
create or replace function app.fold_digits(p_input text) returns text
language sql immutable as $$
  select translate(
    coalesce(p_input, ''),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789'
  );
$$;

-- ---------------------------------------------------------------------------
-- Saudi mobile normalization to strict E.164 (+9665XXXXXXXX).
-- Accepts: 05…, ٠٥…, 5…, 9665…, +966 5…, 00966…, with spaces/dashes/parentheses.
-- Returns the canonical +9665XXXXXXXX or NULL when the value is not a valid KSA mobile.
-- IMMUTABLE: safe inside CHECK constraints and generated columns.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_phone_e164(p_input text) returns text
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := regexp_replace(s, '[^0-9]', '', 'g');   -- keep digits only

  if s = '' then
    return null;
  end if;

  if left(s, 5) = '00966' then
    s := substr(s, 6);
  elsif left(s, 3) = '966' then
    s := substr(s, 4);
  elsif left(s, 1) = '0' then
    s := substr(s, 2);
  end if;

  -- Canonical national significant number: 5XXXXXXXX (9 digits, mobile).
  if s ~ '^5[0-9]{8}$' then
    return '+966' || s;
  end if;

  return null;
end;
$$;

-- Strict variant used at write time: raises instead of silently returning NULL.
create or replace function app.require_phone_e164(p_input text) returns text
language plpgsql immutable as $$
declare
  v text;
begin
  v := app.normalize_phone_e164(p_input);
  if v is null then
    raise exception 'INVALID_PHONE: % is not a valid KSA mobile number', p_input
      using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Money normalization: any human string -> integer halalas (1 SAR = 100 halalas).
-- Strips currency symbols, thousands separators, Arabic digits. Never returns a float.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_amount_halalas(p_input text) returns bigint
language plpgsql immutable as $$
declare
  s text;
  v numeric;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := replace(s, '٫', '.');                    -- Arabic decimal separator
  s := regexp_replace(s, '[^0-9.\-]', '', 'g'); -- drop currency, commas, spaces

  if s = '' or s = '-' or s = '.' then
    return null;
  end if;

  v := s::numeric;
  return round(v * 100)::bigint;
end;
$$;

-- ---------------------------------------------------------------------------
-- Date normalization for import: accepts ISO, dd/mm/yyyy, yyyy/mm/dd, Arabic digits.
-- Gregorian only; Hijri parsing is a Deferred Decision (SCHEMA.md).
-- ---------------------------------------------------------------------------
create or replace function app.normalize_date(p_input text) returns date
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := trim(app.fold_digits(p_input));
  s := replace(replace(s, '.', '/'), '\', '/');
  s := replace(s, '-', '/');

  if s ~ '^\d{4}/\d{1,2}/\d{1,2}$' then
    return to_date(s, 'YYYY/MM/DD');
  elsif s ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    return to_date(s, 'DD/MM/YYYY');
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared updated_at maintenance.
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ================================================================
-- 0004_identity_auth.sql
-- ================================================================
-- 0004_identity_auth.sql
-- Identity layer (global) + authentication primitives.
-- Identity is the GLOBAL person: one row per human, independent of any organization.
-- Identity.id is intended to equal auth.users.id (the JWT sub) when provisioned via Supabase Auth.

-- ---------------------------------------------------------------------------
-- Identity — "who is this person?" (global scope, no org_id)
-- ---------------------------------------------------------------------------
create table app.identity (
  id                     uuid primary key default gen_random_uuid(),
  phone_e164             text not null unique
                           check (phone_e164 ~ '^\+9665[0-9]{8}$'),
  phone_raw              text,                       -- original input, display only
  email                  citext unique,
  full_name              text,
  preferred_locale       text not null default 'ar'
                           check (preferred_locale in ('ar', 'en')),
  status                 text not null default 'active'
                           check (status in ('active', 'disabled')),
  -- Sensitive-operations freeze window: set on phone change and first login from a new device.
  -- Enforced by app.assert_not_frozen() at step-up time (§4).
  security_frozen_until  timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  deleted_by             uuid,
  deleted_reason         text
);

comment on table app.identity is 'Global person. id = auth.uid(). phone_e164 is the global unique login key.';

-- ---------------------------------------------------------------------------
-- AuthMethod — the credentials attached to an identity (phone_otp / passkey / email / sso)
-- ---------------------------------------------------------------------------
create table app.auth_method (
  id            uuid primary key default gen_random_uuid(),
  identity_id   uuid not null references app.identity(id) on delete cascade,
  method        app.auth_method_type not null,
  -- For passkey: credential_id / public_key / sign_count. For sso: provider / subject.
  -- Kept as jsonb so adding WebAuthn/SSO detail needs no migration.
  detail        jsonb not null default '{}'::jsonb,
  is_enabled    boolean not null default true,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text,
  unique (identity_id, method)
);

-- ---------------------------------------------------------------------------
-- Session — device-bound sessions with refresh-token rotation + reuse detection (§4)
-- ---------------------------------------------------------------------------
create table app.session (
  id                  uuid primary key default gen_random_uuid(),
  identity_id         uuid not null references app.identity(id) on delete cascade,
  device_fingerprint  text,
  user_agent          text,
  ip                  inet,
  -- Only the hash of the refresh token is stored.
  refresh_token_hash  text not null,
  rotated_from        uuid references app.session(id),  -- lineage for reuse detection
  reuse_detected      boolean not null default false,
  is_new_device       boolean not null default false,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  revoked_reason      text
);

create index session_identity_idx on app.session (identity_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- OTP challenge — hashed, single-use, expiring (§4). Never stores plaintext.
-- ---------------------------------------------------------------------------
create table app.otp_challenge (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null check (phone_e164 ~ '^\+9665[0-9]{8}$'),
  code_hash     text not null,                     -- digest(code || pepper), never the code
  purpose       text not null default 'login'
                  check (purpose in ('login', 'step_up', 'phone_change_old', 'phone_change_new')),
  ip            inet,
  device_fingerprint text,
  attempts      int not null default 0,
  max_attempts  int not null default 5,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index otp_challenge_phone_idx on app.otp_challenge (phone_e164, created_at desc);

-- ---------------------------------------------------------------------------
-- Auth attempt log — powers rate limiting per phone / IP / device and lockout (§4).
-- ---------------------------------------------------------------------------
create table app.auth_attempt (
  id            bigint generated always as identity primary key,
  phone_e164    text,
  ip            inet,
  device_fingerprint text,
  kind          text not null check (kind in ('otp_request', 'otp_verify_ok', 'otp_verify_fail')),
  created_at    timestamptz not null default now()
);

create index auth_attempt_phone_idx  on app.auth_attempt (phone_e164, created_at desc);
create index auth_attempt_ip_idx     on app.auth_attempt (ip, created_at desc);
create index auth_attempt_device_idx on app.auth_attempt (device_fingerprint, created_at desc);

-- ---------------------------------------------------------------------------
-- SMS outbox — the swappable provider boundary (§4). The Edge Function drains this and
-- hands each row to the active provider (Unifonic / Taqnyat / fallback). Rows are transient:
-- they carry the rendered message (which necessarily contains the OTP) only until sent, then purged.
-- ---------------------------------------------------------------------------
create table app.sms_outbox (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null,
  body          text not null,
  provider      text,                              -- filled by the sender that claimed it
  status        text not null default 'pending'
                  check (status in ('pending', 'sent', 'failed')),
  attempts      int not null default 0,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  purge_after   timestamptz not null default (now() + interval '1 hour')
);

create index sms_outbox_pending_idx on app.sms_outbox (created_at) where status = 'pending';

-- ================================================================
-- 0005_org_membership.sql
-- ================================================================
-- 0005_org_membership.sql
-- Organization, Membership (identity↔org), property-scope, feature flags, invitations.
-- Membership is the (identity_id, org_id) join that lets ONE identity belong to MANY orgs
-- and switch between them. Users are never a table "inside" an org. See SCHEMA.md §3.

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------
create table app.organization (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- Presentation/config only. FORBIDDEN in any data-layer branch (RLS/trigger/constraint). §2
  org_type      app.org_type not null default 'management_office',
  -- KSA legal identity (nullable now; ZATCA/PDPL readiness). §6 deferred
  cr_number     text,          -- السجل التجاري
  vat_number    text,          -- الرقم الضريبي
  default_timezone text not null default 'Asia/Riyadh',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text
);

-- ---------------------------------------------------------------------------
-- FeatureFlag — segment differences (commission/fees, owner statements, brokerage units…)
-- are driven here, NOT by org_type. §2
-- ---------------------------------------------------------------------------
create table app.feature_flag (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  key           text not null,
  is_enabled    boolean not null default false,
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, key)
);

-- ---------------------------------------------------------------------------
-- Membership — where an identity works, with what role, status, and scope.
-- status is NEVER deleted (audit rows reference it). §5
-- scope_all = true  -> access to all properties in the org.
-- scope_all = false -> limited to rows in membership_property_scope. §6 second layer
-- ---------------------------------------------------------------------------
create table app.membership (
  id            uuid primary key default gen_random_uuid(),
  identity_id   uuid not null references app.identity(id) on delete cascade,
  org_id        uuid not null references app.organization(id) on delete cascade,
  role          app.membership_role not null default 'staff',
  status        app.membership_status not null default 'invited',
  scope_all     boolean not null default true,
  invited_by    uuid references app.identity(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text,
  unique (identity_id, org_id)
);

-- The composite index that makes the per-query membership proof cheap. §6 performance
create index membership_lookup_idx on app.membership (identity_id, org_id, status);
create index membership_org_idx    on app.membership (org_id, status);

-- ---------------------------------------------------------------------------
-- Membership property scope (many properties per membership). FK to property added in 0006.
-- ---------------------------------------------------------------------------
create table app.membership_property_scope (
  membership_id uuid not null references app.membership(id) on delete cascade,
  property_id   uuid not null,   -- FK added after property exists (0006)
  created_at    timestamptz not null default now(),
  primary key (membership_id, property_id)
);

-- ---------------------------------------------------------------------------
-- Invitation — accepted by TOKEN, not by phone. Membership is created only on accept. §5
-- ---------------------------------------------------------------------------
create table app.invitation (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  phone_e164    text check (phone_e164 ~ '^\+9665[0-9]{8}$'),
  email         citext,
  role          app.membership_role not null default 'staff',
  scope_all     boolean not null default true,
  scope_property_ids uuid[] not null default '{}',  -- applied on accept
  token_hash    text not null,                       -- hash of the invite token
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references app.identity(id),
  revoked_at    timestamptz,
  revoked_by    uuid,
  created_by    uuid references app.identity(id),
  created_at    timestamptz not null default now(),
  check (phone_e164 is not null or email is not null)
);

create index invitation_org_idx   on app.invitation (org_id) where accepted_at is null and revoked_at is null;
create index invitation_token_idx on app.invitation (token_hash);

-- ================================================================
-- 0006_party_property.sql
-- ================================================================
-- 0006_party_property.sql
-- Party (org-scoped person/entity) + role branches (Owner/Tenant) + property hierarchy.
-- Party unifies "who someone is in this org's records"; identity_id is NULLable and only ever
-- filled via a valid invitation accept — never auto-linked by phone match. See SCHEMA.md §3, §5.

-- ---------------------------------------------------------------------------
-- Party — one row per person/entity in an org's records. Roles branch off it (no duplicates).
-- ---------------------------------------------------------------------------
create table app.party (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  -- NULL until the party accepts a portal invitation. Guarded so it can never be set by phone match. §5
  identity_id   uuid references app.identity(id),
  display_name  text not null,
  legal_kind    app.legal_kind not null default 'individual',
  -- KSA identifiers (nullable now, Ejar-ready). §7 rule 7
  national_id   text,          -- الهوية الوطنية
  iqama_id      text,          -- الإقامة
  cr_number     text,          -- السجل التجاري (companies)
  phone_e164    text check (phone_e164 ~ '^\+9665[0-9]{8}$'),  -- E.164 everywhere. §7 rule 8
  phone_raw     text,
  email         citext,
  roles         app.party_role[] not null default '{}',  -- which role branches exist
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text
);

create index party_org_idx      on app.party (org_id) where deleted_at is null;
create index party_identity_idx on app.party (identity_id) where identity_id is not null;
-- A given identity maps to at most one party per org.
create unique index party_identity_unique_per_org on app.party (org_id, identity_id) where identity_id is not null;

-- ---------------------------------------------------------------------------
-- Owner — the owner role branch. is_self = true is the auto-created owner that represents
-- "the org owns this itself". The direct-owner segment never sees the word "owner" in the UI,
-- but the model underneath is identical to the office model. §2
-- ---------------------------------------------------------------------------
create table app.owner (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  party_id      uuid not null references app.party(id) on delete cascade,
  is_self       boolean not null default false,
  owner_kind    app.legal_kind not null default 'individual',
  -- Bank details: changing the IBAN is a step-up-gated action. §4
  iban          text,          -- stored E.164-style validated at app layer
  bank_name     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text,
  unique (org_id, party_id)
);

-- Exactly one self-owner per org.
create unique index owner_one_self_per_org on app.owner (org_id) where is_self and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Tenant — the tenant role branch.
-- ---------------------------------------------------------------------------
create table app.tenant (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  party_id      uuid not null references app.party(id) on delete cascade,
  tenant_kind   app.legal_kind not null default 'individual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text,
  unique (org_id, party_id)
);

-- ---------------------------------------------------------------------------
-- Property — top of the asset hierarchy. owner_id present from day one, even for self-owned. §7 rule 9
--   Organization → Property → Building → Unit
-- ---------------------------------------------------------------------------
create table app.property (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  owner_id      uuid not null references app.owner(id),
  name          text not null,
  property_kind app.property_kind not null default 'residential',
  deed_number   text,          -- رقم الصك (Ejar-ready)
  address_line  text,
  district      text,
  city          text,
  region        text,
  lat           numeric(9,6),
  lng           numeric(9,6),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text
);

create index property_org_idx   on app.property (org_id) where deleted_at is null;
create index property_owner_idx on app.property (owner_id);

-- Now that property exists, wire the deferred FK from membership scope.
alter table app.membership_property_scope
  add constraint membership_property_scope_property_fk
  foreign key (property_id) references app.property(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Building / Block — optional middle tier.
-- ---------------------------------------------------------------------------
create table app.building (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  property_id   uuid not null references app.property(id) on delete cascade,
  name          text not null,
  floors        int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text
);

create index building_property_idx on app.building (property_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Unit — the leasable asset. current_status is the "now" value; history is authoritative. §7 rule 10
-- ---------------------------------------------------------------------------
create table app.unit (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  property_id    uuid not null references app.property(id) on delete cascade,
  building_id    uuid references app.building(id) on delete set null,
  unit_number    text not null,          -- رقم الوحدة (Ejar-ready)
  unit_ref       text,                   -- external / meter / Ejar unit ref
  floor          text,
  area_sqm       numeric(10,2),
  bedrooms       int,
  bathrooms      int,
  current_status app.unit_status not null default 'vacant',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text,
  unique (property_id, unit_number)
);

create index unit_org_idx      on app.unit (org_id) where deleted_at is null;
create index unit_property_idx on app.unit (property_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- UnitStatusHistory — append segments; to_ts NULL means "current". Occupancy is computed from here.
-- ---------------------------------------------------------------------------
create table app.unit_status_history (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  unit_id       uuid not null references app.unit(id) on delete cascade,
  status        app.unit_status not null,
  reason        text,
  from_ts       timestamptz not null default now(),
  to_ts         timestamptz,
  changed_by    uuid references app.identity(id),
  created_at    timestamptz not null default now()
);

create index unit_status_history_unit_idx on app.unit_status_history (unit_id, from_ts desc);
-- At most one open (current) segment per unit.
create unique index unit_status_open_segment on app.unit_status_history (unit_id) where to_ts is null;

-- ================================================================
-- 0007_contracts_agreements.sql
-- ================================================================
-- 0007_contracts_agreements.sql
-- Contract (immutable after activation), ContractAmendment (versioned changes),
-- ManagementAgreement (independent temporal owner↔property mandate). See SCHEMA.md §7 rules 5, 11.

-- ---------------------------------------------------------------------------
-- Contract — legal lease document. NO financial status column here: paid/overdue is derived
-- from Charge + PaymentAllocation. §7 rule 1. Immutable once active (enforced by trigger, 0011).
-- Ejar-aligned fields present from day one. §7 rule 7
-- ---------------------------------------------------------------------------
create table app.contract (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references app.organization(id) on delete cascade,
  property_id          uuid not null references app.property(id),   -- denormalized for scope + perf
  unit_id              uuid not null references app.unit(id),
  tenant_id            uuid not null references app.tenant(id),
  contract_number      text not null,                 -- internal number
  ejar_contract_number text,                           -- منصة إيجار (nullable, alignment only)
  deed_number          text,                           -- الصك (copied for the legal record)
  contract_kind        app.contract_kind not null default 'residential',
  status               app.contract_status not null default 'draft',
  start_date           date not null,
  end_date             date not null,
  -- Hijri display strings, computed/entered for the printed contract. Display only. §7 rule 4
  start_date_hijri     text,
  end_date_hijri       text,
  annual_rent_halalas  bigint not null check (annual_rent_halalas >= 0),
  payment_frequency    app.payment_frequency not null default 'quarterly',
  deposit_halalas      bigint not null default 0 check (deposit_halalas >= 0),
  service_fees_halalas bigint not null default 0 check (service_fees_halalas >= 0),
  terms                text,
  activated_at         timestamptz,
  terminated_at        timestamptz,
  termination_reason   text,
  created_by           uuid references app.identity(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  deleted_by           uuid,
  deleted_reason       text,
  unique (org_id, contract_number),
  check (end_date >= start_date)
);

create index contract_org_idx      on app.contract (org_id) where deleted_at is null;
create index contract_unit_idx     on app.contract (unit_id);
create index contract_property_idx on app.contract (property_id);
create index contract_tenant_idx   on app.contract (tenant_id);
-- One active contract per unit at a time (partial unique).
create unique index contract_one_active_per_unit on app.contract (unit_id) where status = 'active' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- ContractAmendment — the ONLY way to change an active contract. Versioned, append-only in spirit.
-- payload holds the changed fields (before/after) so we can prove what was in force on a date. §7 rule 5
-- ---------------------------------------------------------------------------
create table app.contract_amendment (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  contract_id    uuid not null references app.contract(id) on delete cascade,
  version        int not null,
  change_type    text not null,          -- e.g. 'rent_change', 'extension', 'early_termination'
  payload        jsonb not null,         -- { field: {from, to}, ... }
  effective_date date not null,
  reason         text,
  created_by     uuid references app.identity(id),
  created_at     timestamptz not null default now(),
  unique (contract_id, version)
);

create index contract_amendment_contract_idx on app.contract_amendment (contract_id, version);

-- ---------------------------------------------------------------------------
-- ManagementAgreement — independent temporal entity linking an Owner to a Property (or specific
-- units) over a period, carrying the fee model and remittance policy. Without it, a correct owner
-- statement or a mid-year property transfer between offices is impossible. §7 rule 11
-- ---------------------------------------------------------------------------
create table app.management_agreement (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references app.organization(id) on delete cascade,
  owner_id           uuid not null references app.owner(id),
  property_id        uuid references app.property(id),   -- NULL => unit-level (see join table)
  valid_from         date not null,
  valid_to           date,                                -- NULL => open-ended
  fee_model          app.fee_model not null,
  fee_percentage     numeric(5,4),                        -- when percentage_of_collection (e.g. 0.0500)
  fee_amount_halalas bigint,                              -- when fixed_amount / per_unit
  remittance_policy  jsonb not null default '{}'::jsonb,  -- payout cadence, hold-back, min balance…
  notes              text,
  created_by         uuid references app.identity(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid,
  deleted_reason     text,
  check (valid_to is null or valid_to >= valid_from),
  check (
    (fee_model = 'percentage_of_collection' and fee_percentage is not null)
    or (fee_model in ('fixed_amount', 'per_unit') and fee_amount_halalas is not null)
  )
);

create index management_agreement_owner_idx    on app.management_agreement (owner_id);
create index management_agreement_property_idx on app.management_agreement (property_id);
create index management_agreement_org_idx      on app.management_agreement (org_id) where deleted_at is null;

-- Unit-level agreements (when property_id is NULL or a subset of a property's units is managed).
create table app.management_agreement_unit (
  agreement_id  uuid not null references app.management_agreement(id) on delete cascade,
  unit_id       uuid not null references app.unit(id) on delete cascade,
  primary key (agreement_id, unit_id)
);

-- ================================================================
-- 0008_charges_payments.sql
-- ================================================================
-- 0008_charges_payments.sql
-- The financial core. Status is DERIVED from these tables, never stored. §7 rule 1.
-- All money is integer halalas (bigint). No float/double anywhere. §7 rule 3.
-- Every Charge is tax-ready from day one. §7 rule 2.

-- ---------------------------------------------------------------------------
-- Charge — a single due line generated by a contract (or ad-hoc). One row per due amount/date.
-- VAT fields present now so a compliant invoice needs no historical back-fill.
-- ---------------------------------------------------------------------------
create table app.charge (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references app.organization(id) on delete cascade,
  property_id           uuid not null references app.property(id),   -- denormalized for scope + perf
  unit_id               uuid references app.unit(id),
  contract_id           uuid references app.contract(id) on delete cascade,
  charge_type           app.charge_type not null,
  description           text,
  due_date              date not null,
  currency              text not null default 'SAR' check (currency = 'SAR'),
  amount_excl_vat_halalas bigint not null check (amount_excl_vat_halalas >= 0),
  vat_rate              numeric(5,4) not null default 0.0000 check (vat_rate >= 0 and vat_rate <= 1),
  vat_amount_halalas    bigint not null default 0 check (vat_amount_halalas >= 0),
  -- Generated: the gross due. Payments allocate against this.
  amount_incl_vat_halalas bigint generated always as
                          (amount_excl_vat_halalas + vat_amount_halalas) stored,
  created_by            uuid references app.identity(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  deleted_by            uuid,
  deleted_reason        text
);

create index charge_org_idx      on app.charge (org_id) where deleted_at is null;
create index charge_contract_idx on app.charge (contract_id);
create index charge_property_idx on app.charge (property_id);
create index charge_due_idx      on app.charge (org_id, due_date) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Payment — money received. Separate from charges; matched via PaymentAllocation.
-- One payment can cover several charges; one charge can be covered by several payments.
-- ---------------------------------------------------------------------------
create table app.payment (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  party_id       uuid references app.party(id),        -- payer (usually the tenant)
  method         app.payment_method not null default 'bank_transfer',
  amount_halalas bigint not null check (amount_halalas > 0),
  received_at    timestamptz not null default now(),
  reference      text,                                  -- bank ref / SADAD bill / gateway id
  notes          text,
  created_by     uuid references app.identity(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text
);

create index payment_org_idx   on app.payment (org_id) where deleted_at is null;
create index payment_party_idx on app.payment (party_id);

-- ---------------------------------------------------------------------------
-- PaymentAllocation — matches a payment to a charge for a specific amount.
-- Enforced invariants (trigger, 0011):
--   sum(alloc.amount) per payment <= payment.amount
--   sum(alloc.amount) per charge  <= charge.amount_incl_vat
-- Partial, late, overpayment, and one-payment-covers-two-charges all fall out of this. §10 test 12
-- ---------------------------------------------------------------------------
create table app.payment_allocation (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  payment_id     uuid not null references app.payment(id) on delete cascade,
  charge_id      uuid not null references app.charge(id) on delete cascade,
  amount_halalas bigint not null check (amount_halalas > 0),
  created_at     timestamptz not null default now(),
  unique (payment_id, charge_id)
);

create index payment_allocation_payment_idx on app.payment_allocation (payment_id);
create index payment_allocation_charge_idx  on app.payment_allocation (charge_id);

-- ================================================================
-- 0009_documents_audit.sql
-- ================================================================
-- 0009_documents_audit.sql
-- Document (polymorphic attachment) + AuditLog (append-only, three identifiers). SCHEMA.md §8.

-- ---------------------------------------------------------------------------
-- Document — files (deeds, contracts, IDs) attached to any entity. Storage lives in Supabase
-- Storage; we keep the pointer + metadata here, org-scoped.
-- ---------------------------------------------------------------------------
create table app.document (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  entity_type   app.document_entity not null,
  entity_id     uuid not null,
  -- property_id copied when known, so document RLS can honor property scope cheaply.
  property_id   uuid references app.property(id),
  storage_bucket text not null default 'documents',
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  byte_size     bigint,
  uploaded_by   uuid references app.identity(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_reason text
);

create index document_org_idx    on app.document (org_id) where deleted_at is null;
create index document_entity_idx on app.document (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- AuditLog — append-only from line one. UPDATE/DELETE blocked by trigger (0011).
-- Three identifiers per row:
--   identity_id   = who acted
--   org_id        = in which org context
--   membership_id = with which role/scope AT THAT TIME (proves the action was authorized then). §8
-- Also records org-switch, login attempts, session lifecycle, and every step-up.
-- ---------------------------------------------------------------------------
create table app.audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid,                                   -- nullable for global events (login, org switch)
  identity_id   uuid,
  membership_id uuid,
  action        text not null,                          -- e.g. 'contract.activate', 'auth.org_switch'
  entity_type   text,
  entity_id     uuid,
  -- Structured before/after or event detail. Never mutated.
  detail        jsonb not null default '{}'::jsonb,
  ip            inet,
  device_fingerprint text,
  created_at    timestamptz not null default now()
);

create index audit_log_org_idx      on app.audit_log (org_id, created_at desc);
create index audit_log_identity_idx on app.audit_log (identity_id, created_at desc);
create index audit_log_entity_idx   on app.audit_log (entity_type, entity_id);

-- ================================================================
-- 0010_import_staging.sql
-- ================================================================
-- 0010_import_staging.sql
-- Excel import staging. Rows land here first, are validated per-row, previewed, then committed
-- in one transaction. A whole batch can be reverted. Normalization (phone/date/amount) runs on
-- ingest using the same app.normalize_* functions used everywhere else. SCHEMA.md §11.

create table app.import_batch (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organization(id) on delete cascade,
  kind          app.import_kind not null,
  status        app.import_status not null default 'draft',
  source_filename text,
  total_rows    int not null default 0,
  valid_rows    int not null default 0,
  error_rows    int not null default 0,
  created_by    uuid references app.identity(id),
  created_at    timestamptz not null default now(),
  committed_at  timestamptz,
  reverted_at   timestamptz,
  reverted_by   uuid
);

create index import_batch_org_idx on app.import_batch (org_id, created_at desc);

create table app.import_row (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references app.import_batch(id) on delete cascade,
  org_id         uuid not null references app.organization(id) on delete cascade,
  row_number     int not null,               -- 1-based row in the source sheet
  raw            jsonb not null,             -- original cell values keyed by Arabic header
  normalized     jsonb,                      -- after normalization, keyed by canonical field
  is_valid       boolean not null default false,
  -- Per-field rejection reasons: [{ field, value, reason }]
  errors         jsonb not null default '[]'::jsonb,
  -- Set on commit so a revert can find and soft-delete exactly what this row created.
  created_entity_type text,
  created_entity_id   uuid,
  created_at     timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index import_row_batch_idx on app.import_row (batch_id, row_number);

-- ================================================================
-- 0011_access_functions.sql
-- ================================================================
-- 0011_access_functions.sql
-- The isolation core. Every RLS policy is expressed in terms of these helpers. SCHEMA.md §6.
--
-- Design invariants:
--   * org_id is NEVER read from the JWT. The active org arrives as request context and is treated
--     as an UNTRUSTED claim, proven against live membership on every single query.
--   * The membership proof lives in SECURITY DEFINER functions with a fixed search_path, so the
--     membership table's own RLS policy can call them without infinite recursion.
--   * Functions are STABLE, so Postgres caches them within a statement/request → cheap at scale.

-- ---------------------------------------------------------------------------
-- current_org_id() — the active org for this request.
-- Priority 1: a GUC set by trusted server code (Edge Functions / service role).
-- Priority 2: the x-active-org request header (PostgREST). Untrusted; proven below.
-- Fails closed (NULL) → policies deny.
-- ---------------------------------------------------------------------------
create or replace function app.current_org_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('app.current_org_id', true), ''),
    nullif(
      (nullif(current_setting('request.headers', true), '')::json ->> 'x-active-org'),
      ''
    )
  )::uuid;
$$;

-- ---------------------------------------------------------------------------
-- has_org_access(p_org) — the single gate used by every org-scoped policy.
-- True only when: the row's org equals the active org context AND the caller has a LIVE active
-- membership in it. Revoking a membership flips this to false on the very next query. §10 test 2.
-- SECURITY DEFINER + fixed search_path → does not trigger membership RLS (no recursion). §6.
-- ---------------------------------------------------------------------------
create or replace function app.has_org_access(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select p_org is not null
     and p_org = app.current_org_id()
     and exists (
       select 1
       from app.membership m
       where m.identity_id = auth.uid()
         and m.org_id      = p_org
         and m.status      = 'active'
         and m.deleted_at is null
     );
$$;

-- ---------------------------------------------------------------------------
-- has_property_access(p_org, p_property) — the second isolation layer (portfolio scope). §6.
-- A membership with scope_all sees everything in its org; otherwise it is confined to the
-- properties listed in membership_property_scope. NULL property (org-level rows) → org gate only.
-- ---------------------------------------------------------------------------
create or replace function app.has_property_access(p_org uuid, p_property uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.has_org_access(p_org)
     and (
       p_property is null
       or exists (
         select 1
         from app.membership m
         where m.identity_id = auth.uid()
           and m.org_id      = p_org
           and m.status      = 'active'
           and m.deleted_at is null
           and (
             m.scope_all
             or exists (
               select 1 from app.membership_property_scope s
               where s.membership_id = m.id
                 and s.property_id    = p_property
             )
           )
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- current_membership_id() — the caller's membership in the active org. Stamped onto audit rows
-- as the third identifier (role/scope at the time of the action). §8.
-- ---------------------------------------------------------------------------
create or replace function app.current_membership_id() returns uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select m.id
  from app.membership m
  where m.identity_id = auth.uid()
    and m.org_id      = app.current_org_id()
    and m.status      = 'active'
    and m.deleted_at is null
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- is_org_admin(p_org) — owner/admin gate for member management and other privileged writes.
-- ---------------------------------------------------------------------------
create or replace function app.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.has_org_access(p_org)
     and exists (
       select 1 from app.membership m
       where m.identity_id = auth.uid()
         and m.org_id      = p_org
         and m.status      = 'active'
         and m.deleted_at is null
         and m.role in ('owner', 'admin')
     );
$$;

-- Lock down who may execute the access helpers.
revoke all on function app.current_org_id()           from public;
revoke all on function app.has_org_access(uuid)        from public;
revoke all on function app.has_property_access(uuid, uuid) from public;
revoke all on function app.current_membership_id()     from public;
revoke all on function app.is_org_admin(uuid)          from public;

grant execute on function app.current_org_id()           to authenticated, service_role;
grant execute on function app.has_org_access(uuid)        to authenticated, service_role;
grant execute on function app.has_property_access(uuid, uuid) to authenticated, service_role;
grant execute on function app.current_membership_id()     to authenticated, service_role;
grant execute on function app.is_org_admin(uuid)          to authenticated, service_role;

-- ================================================================
-- 0012_rls_policies.sql
-- ================================================================
-- 0012_rls_policies.sql
-- RLS enabled on EVERY table. Org-scoped tables gate on app.has_org_access(org_id); portfolio
-- tables add app.has_property_access(org_id, property_id). Auth-layer tables are self-only or
-- service-role-only. service_role bypasses RLS by design (trusted server code). SCHEMA.md §6.

-- ===========================================================================
-- Base privileges. RLS only filters rows the role is otherwise allowed to touch.
-- authenticated gets DML on data tables; RLS does the confinement. Hard DELETE is withheld
-- (soft-delete convention, §7 rule 6) except on link/staging tables where physical delete is valid.
-- ===========================================================================
grant select, insert, update on
  app.organization, app.feature_flag, app.membership, app.invitation,
  app.party, app.owner, app.tenant,
  app.property, app.building, app.unit, app.unit_status_history,
  app.contract, app.contract_amendment, app.management_agreement,
  app.charge, app.payment, app.payment_allocation,
  app.document, app.import_batch, app.import_row
to authenticated;

grant select, insert, update, delete on
  app.membership_property_scope, app.management_agreement_unit, app.payment_allocation
to authenticated;

grant select on app.identity, app.auth_method, app.session to authenticated;
grant update on app.identity to authenticated;
grant select, insert on app.audit_log to authenticated;

-- ===========================================================================
-- Enable RLS everywhere.
-- ===========================================================================
alter table app.identity                    enable row level security;
alter table app.auth_method                  enable row level security;
alter table app.session                      enable row level security;
alter table app.otp_challenge                enable row level security;
alter table app.auth_attempt                 enable row level security;
alter table app.sms_outbox                   enable row level security;
alter table app.organization                 enable row level security;
alter table app.feature_flag                 enable row level security;
alter table app.membership                   enable row level security;
alter table app.membership_property_scope    enable row level security;
alter table app.invitation                   enable row level security;
alter table app.party                        enable row level security;
alter table app.owner                        enable row level security;
alter table app.tenant                       enable row level security;
alter table app.property                     enable row level security;
alter table app.building                     enable row level security;
alter table app.unit                         enable row level security;
alter table app.unit_status_history          enable row level security;
alter table app.contract                     enable row level security;
alter table app.contract_amendment           enable row level security;
alter table app.management_agreement         enable row level security;
alter table app.management_agreement_unit    enable row level security;
alter table app.charge                       enable row level security;
alter table app.payment                      enable row level security;
alter table app.payment_allocation           enable row level security;
alter table app.document                     enable row level security;
alter table app.audit_log                    enable row level security;
alter table app.import_batch                 enable row level security;
alter table app.import_row                   enable row level security;

-- ===========================================================================
-- Auth layer — self-only. otp_challenge / auth_attempt / sms_outbox: NO authenticated policy
-- (RLS enabled + no policy = deny); only service_role (bypassrls) touches them.
-- ===========================================================================
create policy identity_self_select on app.identity for select using (id = auth.uid());
create policy identity_self_update on app.identity for update using (id = auth.uid()) with check (id = auth.uid());

create policy auth_method_self on app.auth_method for select using (identity_id = auth.uid());
create policy session_self      on app.session     for select using (identity_id = auth.uid());

-- ===========================================================================
-- Organization — visible to its live members; updatable by admins. Creation is a SECURITY DEFINER
-- RPC (0013) run under service role, so no INSERT policy for authenticated.
-- ===========================================================================
create policy organization_select on app.organization for select using (app.has_org_access(id));
create policy organization_update on app.organization for update using (app.is_org_admin(id)) with check (app.is_org_admin(id));

-- ===========================================================================
-- Feature flags — read by members, written by admins.
-- ===========================================================================
create policy feature_flag_select on app.feature_flag for select using (app.has_org_access(org_id));
create policy feature_flag_write  on app.feature_flag for all
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));

-- ===========================================================================
-- Membership — self rows always visible; admins see all org rows. Writes: admins only.
-- has_org_access / is_org_admin are SECURITY DEFINER so this policy does NOT recurse. §6
-- ===========================================================================
create policy membership_select on app.membership for select
  using (identity_id = auth.uid() or app.has_org_access(org_id));
create policy membership_insert on app.membership for insert
  with check (app.is_org_admin(org_id));
create policy membership_update on app.membership for update
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));

create policy membership_scope_select on app.membership_property_scope for select
  using (exists (select 1 from app.membership m where m.id = membership_id and app.has_org_access(m.org_id)));
create policy membership_scope_write on app.membership_property_scope for all
  using (exists (select 1 from app.membership m where m.id = membership_id and app.is_org_admin(m.org_id)))
  with check (exists (select 1 from app.membership m where m.id = membership_id and app.is_org_admin(m.org_id)));

-- ===========================================================================
-- Invitation — admins manage. (Acceptance is a SECURITY DEFINER RPC, 0013.)
-- ===========================================================================
create policy invitation_select on app.invitation for select using (app.has_org_access(org_id));
create policy invitation_write  on app.invitation for all
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));

-- ===========================================================================
-- Parties & role branches — any active member of the org.
-- ===========================================================================
create policy party_all  on app.party  for all using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));
create policy owner_all  on app.owner  for all using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));
create policy tenant_all on app.tenant for all using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

-- ===========================================================================
-- Portfolio tables — org gate + property scope. §6 second layer, §10 test 4.
-- ===========================================================================
create policy property_all on app.property for all
  using (app.has_property_access(org_id, id))
  with check (app.has_property_access(org_id, id));

create policy building_all on app.building for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy unit_all on app.unit for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy unit_status_history_all on app.unit_status_history for all
  using (exists (select 1 from app.unit u where u.id = unit_id and app.has_property_access(u.org_id, u.property_id)))
  with check (exists (select 1 from app.unit u where u.id = unit_id and app.has_property_access(u.org_id, u.property_id)));

create policy contract_all on app.contract for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy contract_amendment_all on app.contract_amendment for all
  using (exists (select 1 from app.contract c where c.id = contract_id and app.has_property_access(c.org_id, c.property_id)))
  with check (exists (select 1 from app.contract c where c.id = contract_id and app.has_property_access(c.org_id, c.property_id)));

-- Management agreements can be property-level or unit-level (property_id NULL) → org gate covers NULL.
create policy management_agreement_all on app.management_agreement for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy management_agreement_unit_all on app.management_agreement_unit for all
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_org_access(a.org_id)))
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_org_access(a.org_id)));

-- ===========================================================================
-- Financials — charge is property-scoped; payment/allocation are org-scoped (accountant view).
-- ===========================================================================
create policy charge_all on app.charge for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

create policy payment_all on app.payment for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

create policy payment_allocation_all on app.payment_allocation for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

-- ===========================================================================
-- Documents — org gate + property scope when property_id is set (NULL → org-level).
-- ===========================================================================
create policy document_all on app.document for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

-- ===========================================================================
-- Audit log — members read their org's log; anyone active can append. UPDATE/DELETE blocked by
-- trigger (0013), so no update/delete policy exists. §8
-- ===========================================================================
create policy audit_log_select on app.audit_log for select using (org_id is not null and app.has_org_access(org_id));
create policy audit_log_insert on app.audit_log for insert with check (org_id is null or app.has_org_access(org_id));

-- ===========================================================================
-- Import staging — org-scoped.
-- ===========================================================================
create policy import_batch_all on app.import_batch for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));
create policy import_row_all on app.import_row for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

-- ================================================================
-- 0013_triggers_guards.sql
-- ================================================================
-- 0013_triggers_guards.sql
-- Behavioural guarantees: updated_at, contract immutability, last-owner protection, the
-- Party↔Identity no-auto-link guard, unit-status history, allocation invariants, append-only audit,
-- and the SECURITY DEFINER RPCs (org creation, invitation accept, explicit party link, org switch).

-- ---------------------------------------------------------------------------
-- updated_at maintenance on every mutable table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'identity','auth_method','organization','feature_flag','membership','party','owner','tenant',
    'property','building','unit','contract','management_agreement','charge','payment','document'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on app.%I
         for each row execute function app.set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Contract immutability after activation. §7 rule 5.
-- Once status = 'active', the legal/financial fields are frozen; only lifecycle transitions
-- (status, termination, soft-delete) may change. Everything else must go through an amendment.
-- ---------------------------------------------------------------------------
create or replace function app.tg_contract_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'active' then
    if row(
         new.property_id, new.unit_id, new.tenant_id, new.contract_number, new.ejar_contract_number,
         new.deed_number, new.contract_kind, new.start_date, new.end_date, new.start_date_hijri,
         new.end_date_hijri, new.annual_rent_halalas, new.payment_frequency, new.deposit_halalas,
         new.service_fees_halalas, new.terms
       ) is distinct from row(
         old.property_id, old.unit_id, old.tenant_id, old.contract_number, old.ejar_contract_number,
         old.deed_number, old.contract_kind, old.start_date, old.end_date, old.start_date_hijri,
         old.end_date_hijri, old.annual_rent_halalas, old.payment_frequency, old.deposit_halalas,
         old.service_fees_halalas, old.terms
       )
    then
      raise exception 'CONTRACT_IMMUTABLE: active contract % cannot be edited; create a contract_amendment', old.id
        using errcode = 'raise_exception';
    end if;
  end if;
  return new;
end;
$$;

create trigger contract_immutable before update on app.contract
  for each row execute function app.tg_contract_immutable();

-- ---------------------------------------------------------------------------
-- Last-owner protection. §5. Cannot delete/downgrade/suspend the last active org owner.
-- ---------------------------------------------------------------------------
create or replace function app.tg_protect_last_owner() returns trigger
language plpgsql as $$
declare
  remaining int;
begin
  if old.role = 'owner' and old.status = 'active' and old.deleted_at is null then
    if tg_op = 'DELETE'
       or new.role <> 'owner'
       or new.status <> 'active'
       or new.deleted_at is not null then
      select count(*) into remaining
      from app.membership m
      where m.org_id = old.org_id
        and m.role = 'owner'
        and m.status = 'active'
        and m.deleted_at is null
        and m.id <> old.id;
      if remaining = 0 then
        raise exception 'LAST_OWNER_PROTECTED: cannot remove or downgrade the last active owner of org %', old.org_id
          using errcode = 'raise_exception';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger protect_last_owner before update or delete on app.membership
  for each row execute function app.tg_protect_last_owner();

-- ---------------------------------------------------------------------------
-- Party↔Identity no-auto-link guard. §5, §10 test 10.
-- identity_id may transition from NULL to a value ONLY while the session flag app.allow_party_link
-- is 'on', which is set exclusively inside the SECURITY DEFINER accept/link RPCs below. A phone
-- match alone can never link — there is simply no code path that does it.
-- ---------------------------------------------------------------------------
create or replace function app.tg_party_identity_guard() returns trigger
language plpgsql as $$
begin
  if new.identity_id is not null
     and (tg_op = 'INSERT' or old.identity_id is distinct from new.identity_id) then
    if coalesce(current_setting('app.allow_party_link', true), '') <> 'on' then
      raise exception 'PARTY_LINK_FORBIDDEN: Party.identity_id can only be set via a valid invitation accept'
        using errcode = 'raise_exception';
    end if;
  end if;
  return new;
end;
$$;

create trigger party_identity_guard before insert or update on app.party
  for each row execute function app.tg_party_identity_guard();

-- ---------------------------------------------------------------------------
-- Unit status ↔ history sync. §7 rule 10. Keeps exactly one open segment per unit.
-- ---------------------------------------------------------------------------
create or replace function app.tg_unit_status_sync() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into app.unit_status_history (org_id, unit_id, status, from_ts, changed_by)
    values (new.org_id, new.id, new.current_status, now(), auth.uid());
  elsif tg_op = 'UPDATE' and new.current_status is distinct from old.current_status then
    update app.unit_status_history set to_ts = now()
    where unit_id = new.id and to_ts is null;
    insert into app.unit_status_history (org_id, unit_id, status, from_ts, changed_by)
    values (new.org_id, new.id, new.current_status, now(), auth.uid());
  end if;
  return null;
end;
$$;

create trigger unit_status_sync after insert or update of current_status on app.unit
  for each row execute function app.tg_unit_status_sync();

-- ---------------------------------------------------------------------------
-- Allocation invariants. §7 rule 1, §10 test 12.
-- No allocation may push a payment over its amount or a charge over its gross due; org must match.
-- Partial / late / overpayment / one-payment-two-charges all fall out of these two ceilings.
-- ---------------------------------------------------------------------------
create or replace function app.tg_allocation_check() returns trigger
language plpgsql as $$
declare
  pay_amount bigint; p_org uuid;
  chg_gross  bigint; c_org uuid;
  pay_used   bigint; chg_used bigint;
begin
  select amount_halalas, org_id into pay_amount, p_org from app.payment where id = new.payment_id;
  select amount_incl_vat_halalas, org_id into chg_gross, c_org from app.charge where id = new.charge_id;

  if p_org is null or c_org is null then
    raise exception 'ALLOCATION_BAD_REF' using errcode = 'raise_exception';
  end if;
  if new.org_id <> p_org or new.org_id <> c_org then
    raise exception 'ALLOCATION_ORG_MISMATCH: allocation org must equal payment and charge org'
      using errcode = 'raise_exception';
  end if;

  select coalesce(sum(amount_halalas), 0) into pay_used
  from app.payment_allocation where payment_id = new.payment_id and id <> new.id;
  select coalesce(sum(amount_halalas), 0) into chg_used
  from app.payment_allocation where charge_id = new.charge_id and id <> new.id;

  if pay_used + new.amount_halalas > pay_amount then
    raise exception 'ALLOCATION_EXCEEDS_PAYMENT: payment % over-allocated', new.payment_id
      using errcode = 'raise_exception';
  end if;
  if chg_used + new.amount_halalas > chg_gross then
    raise exception 'ALLOCATION_EXCEEDS_CHARGE: charge % over-allocated', new.charge_id
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

create trigger allocation_check before insert or update on app.payment_allocation
  for each row execute function app.tg_allocation_check();

-- ---------------------------------------------------------------------------
-- Audit log append-only. §8. No UPDATE, no DELETE — ever.
-- ---------------------------------------------------------------------------
create or replace function app.tg_audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'AUDIT_APPEND_ONLY: audit_log rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

create trigger audit_immutable before update or delete on app.audit_log
  for each row execute function app.tg_audit_immutable();

-- ---------------------------------------------------------------------------
-- write_audit — helper that stamps the three identifiers. §8.
-- ---------------------------------------------------------------------------
create or replace function app.write_audit(
  p_org uuid, p_action text, p_entity_type text default null,
  p_entity_id uuid default null, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
begin
  insert into app.audit_log (org_id, identity_id, membership_id, action, entity_type, entity_id, detail)
  values (
    p_org,
    auth.uid(),
    case when p_org is null then null else app.current_membership_id() end,
    p_action, p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_organization — the only way an org is born. Creates the org, the creator's owner
-- membership, and the auto self-Owner (is_self = true) with its Party. §2.
-- SECURITY DEFINER: runs above RLS; sets allow_party_link only for the rows it creates.
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
-- accept_invitation — accept by TOKEN (never by phone). Creates the membership on accept. §5.
-- ---------------------------------------------------------------------------
create or replace function app.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_inv    app.invitation;
  v_me     uuid := auth.uid();
  v_mid    uuid;
  v_prop   uuid;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  select * into v_inv
  from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  limit 1;

  if v_inv.id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used'
      using errcode = 'raise_exception';
  end if;

  insert into app.membership (identity_id, org_id, role, status, scope_all, invited_by)
  values (v_me, v_inv.org_id, v_inv.role, 'active', v_inv.scope_all, v_inv.created_by)
  on conflict (identity_id, org_id)
  do update set status = 'active', role = excluded.role, scope_all = excluded.scope_all
  returning id into v_mid;

  if not v_inv.scope_all then
    foreach v_prop in array v_inv.scope_property_ids loop
      insert into app.membership_property_scope (membership_id, property_id)
      values (v_mid, v_prop) on conflict do nothing;
    end loop;
  end if;

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'invitation.accept', 'membership', v_mid,
                          jsonb_build_object('invitation_id', v_inv.id));
  return v_mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- link_party_identity — the ONLY sanctioned way to attach an Identity to a Party, and only with a
-- valid invitation token addressed to that party's org. Sets allow_party_link for this statement. §5.
-- ---------------------------------------------------------------------------
create or replace function app.link_party_identity(p_party_id uuid, p_token text) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_me    uuid := auth.uid();
  v_org   uuid;
  v_inv   app.invitation;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  select org_id into v_org from app.party where id = p_party_id;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  select * into v_inv
  from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and org_id = v_org
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  limit 1;

  if v_inv.id is null then
    raise exception 'INVITATION_INVALID' using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);   -- transaction-local
  update app.party set identity_id = v_me where id = p_party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_org, 'party.link_identity', 'party', p_party_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- switch_active_org — records the org-switch event (the switch itself is header-driven). §8.
-- ---------------------------------------------------------------------------
create or replace function app.switch_active_org(p_org uuid) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
begin
  if not exists (
    select 1 from app.membership m
    where m.identity_id = auth.uid() and m.org_id = p_org
      and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'NOT_A_MEMBER' using errcode = 'raise_exception';
  end if;
  insert into app.audit_log (org_id, identity_id, membership_id, action)
  values (p_org, auth.uid(),
          (select id from app.membership where identity_id = auth.uid() and org_id = p_org limit 1),
          'auth.org_switch');
end;
$$;

revoke all on function app.create_organization(text, app.org_type) from public;
revoke all on function app.accept_invitation(text)                 from public;
revoke all on function app.link_party_identity(uuid, text)         from public;
revoke all on function app.switch_active_org(uuid)                 from public;
revoke all on function app.write_audit(uuid, text, text, uuid, jsonb) from public;
grant execute on function app.create_organization(text, app.org_type) to authenticated, service_role;
grant execute on function app.accept_invitation(text)                 to authenticated, service_role;
grant execute on function app.link_party_identity(uuid, text)         to authenticated, service_role;
grant execute on function app.switch_active_org(uuid)                 to authenticated, service_role;
grant execute on function app.write_audit(uuid, text, text, uuid, jsonb) to authenticated, service_role;

-- ================================================================
-- 0014_auth_otp.sql
-- ================================================================
-- 0014_auth_otp.sql
-- Phone-first OTP: cryptographic 6-digit codes, hashed+peppered storage, single-use, 5-minute expiry,
-- per phone/IP/device rate limiting, escalating lockout, and account-enumeration-safe uniform
-- responses. SECURITY DEFINER (these run pre-auth as anon and must reach the auth-layer tables). §4.

-- Server-side pepper. In production set: ALTER DATABASE <db> SET app.otp_pepper = '<secret>';
create or replace function app.otp_pepper() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.otp_pepper', true), ''), 'dev-only-pepper-change-me');
$$;

-- Cryptographic 6-digit code (NOT Math.random / random()). §4.
create or replace function app.gen_otp_code() returns text
language plpgsql volatile set search_path = app, extensions, pg_temp as $$
declare
  b bytea := gen_random_bytes(4);
  n bigint;
begin
  n := (get_byte(b,0)::bigint * 16777216)
     + (get_byte(b,1)::bigint * 65536)
     + (get_byte(b,2)::bigint * 256)
     + get_byte(b,3)::bigint;
  return lpad((n % 1000000)::text, 6, '0');
end;
$$;

-- Rate gate: at most 5 requests per phone / IP / device in a rolling 15 minutes,
-- and an escalating lock when recent verify failures pile up. §4.
create or replace function app.otp_rate_ok(p_phone text, p_ip inet, p_device text) returns boolean
language sql stable security definer set search_path = app, extensions, pg_temp as $$
  select
    -- the current request has already been recorded, so <= 5 allows exactly 5 sends per window
    (select count(*) from app.auth_attempt
       where phone_e164 = p_phone and kind = 'otp_request'
         and created_at > now() - interval '15 minutes') <= 5
    and (p_ip is null or (select count(*) from app.auth_attempt
       where ip = p_ip and kind = 'otp_request'
         and created_at > now() - interval '15 minutes') < 20)
    and (p_device is null or (select count(*) from app.auth_attempt
       where device_fingerprint = p_device and kind = 'otp_request'
         and created_at > now() - interval '15 minutes') < 10)
    -- escalating lock: too many recent failures for this phone → cool down
    and (select count(*) from app.auth_attempt
       where phone_e164 = p_phone and kind = 'otp_verify_fail'
         and created_at > now() - interval '15 minutes') < 10;
$$;

-- ---------------------------------------------------------------------------
-- request_otp — ALWAYS returns void (uniform). Whether the phone maps to an existing identity or
-- not, behaviour is identical: no account enumeration. §4, §10 tests 8 & 9.
-- When rate-limited, records the attempt but creates no challenge and enqueues no SMS.
-- ---------------------------------------------------------------------------
create or replace function app.request_otp(
  p_phone_input text,
  p_ip inet default null,
  p_device text default null,
  p_purpose text default 'login'
) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text := app.normalize_phone_e164(p_phone_input);
  v_code  text;
begin
  -- Record the attempt regardless (feeds rate limiting) — uniform work either way.
  insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
  values (v_phone, p_ip, p_device, 'otp_request');

  -- Invalid phone or throttled → stop silently (still returns void). No leak.
  if v_phone is null then
    return;
  end if;
  if not app.otp_rate_ok(v_phone, p_ip, p_device) then
    return;
  end if;

  v_code := app.gen_otp_code();

  insert into app.otp_challenge (phone_e164, code_hash, purpose, ip, device_fingerprint, expires_at)
  values (
    v_phone,
    encode(digest(v_code || app.otp_pepper(), 'sha256'), 'hex'),
    p_purpose, p_ip, p_device,
    now() + interval '5 minutes'
  );

  -- Hand the rendered message to the swappable provider boundary.
  insert into app.sms_outbox (phone_e164, body)
  values (v_phone, 'رمز الدخول: ' || v_code || ' — صالح لمدة 5 دقائق.');
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_otp — returns the identity_id on success, NULL on ANY failure (uniform). On a successful
-- 'login' for a new number, the identity is created (phone-first registration). §4.
-- Enforces single-use, expiry, and max-attempts lockout. §10 test 7.
-- ---------------------------------------------------------------------------
create or replace function app.verify_otp(
  p_phone_input text,
  p_code text,
  p_ip inet default null,
  p_device text default null,
  p_purpose text default 'login'
) returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text := app.normalize_phone_e164(p_phone_input);
  v_ch    app.otp_challenge;
  v_id    uuid;
begin
  if v_phone is null then
    return null;
  end if;

  select * into v_ch
  from app.otp_challenge
  where phone_e164 = v_phone
    and purpose = p_purpose
    and consumed_at is null
    and expires_at > now()
    and attempts < max_attempts
  order by created_at desc
  limit 1;

  if v_ch.id is null then
    insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
    values (v_phone, p_ip, p_device, 'otp_verify_fail');
    return null;   -- no valid challenge (expired / consumed / locked / never requested)
  end if;

  if v_ch.code_hash <> encode(digest(coalesce(p_code, '') || app.otp_pepper(), 'sha256'), 'hex') then
    update app.otp_challenge set attempts = attempts + 1 where id = v_ch.id;
    insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
    values (v_phone, p_ip, p_device, 'otp_verify_fail');
    return null;   -- wrong code
  end if;

  -- Success: consume single-use, resolve/create identity.
  update app.otp_challenge set consumed_at = now() where id = v_ch.id;

  select id into v_id from app.identity where phone_e164 = v_phone;
  if v_id is null and p_purpose = 'login' then
    insert into app.identity (phone_e164, phone_raw) values (v_phone, p_phone_input)
    returning id into v_id;
    insert into app.auth_method (identity_id, method) values (v_id, 'phone_otp');
  end if;

  insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
  values (v_phone, p_ip, p_device, 'otp_verify_ok');
  return v_id;
end;
$$;

revoke all on function app.request_otp(text, inet, text, text) from public;
revoke all on function app.verify_otp(text, text, inet, text, text) from public;
grant execute on function app.request_otp(text, inet, text, text)      to anon, authenticated, service_role;
grant execute on function app.verify_otp(text, text, inet, text, text) to anon, authenticated, service_role;

-- ================================================================
-- 0015_financial_views.sql
-- ================================================================
-- 0015_financial_views.sql
-- Financial status is DERIVED here, never stored. §7 rule 1.
-- security_invoker = true (PG15+) so the querying user's RLS applies — a view must NOT become an
-- RLS bypass. Every view therefore only ever exposes the caller's own org rows.

-- ---------------------------------------------------------------------------
-- charge_balance — the atom. Gross due vs. allocated payments → balance / settled / overdue.
-- ---------------------------------------------------------------------------
create view app.charge_balance
  with (security_invoker = true) as
select
  c.id                                   as charge_id,
  c.org_id,
  c.property_id,
  c.unit_id,
  c.contract_id,
  c.charge_type,
  c.due_date,
  c.amount_excl_vat_halalas,
  c.vat_amount_halalas,
  c.amount_incl_vat_halalas              as gross_halalas,
  coalesce(a.allocated_halalas, 0)       as allocated_halalas,
  c.amount_incl_vat_halalas - coalesce(a.allocated_halalas, 0) as balance_halalas,
  (c.amount_incl_vat_halalas - coalesce(a.allocated_halalas, 0)) <= 0 as is_settled,
  (c.amount_incl_vat_halalas - coalesce(a.allocated_halalas, 0)) > 0
    and c.due_date < current_date        as is_overdue
from app.charge c
left join (
  select charge_id, sum(amount_halalas) as allocated_halalas
  from app.payment_allocation
  group by charge_id
) a on a.charge_id = c.id
where c.deleted_at is null;

-- ---------------------------------------------------------------------------
-- contract_financial — per-contract rollup.
-- ---------------------------------------------------------------------------
create view app.contract_financial
  with (security_invoker = true) as
select
  cb.org_id,
  cb.contract_id,
  count(*)                                            as charge_count,
  sum(cb.gross_halalas)                               as total_due_halalas,
  sum(cb.allocated_halalas)                           as total_paid_halalas,
  sum(cb.balance_halalas)                             as balance_halalas,
  sum(case when cb.is_overdue then cb.balance_halalas else 0 end) as overdue_halalas,
  min(cb.due_date) filter (where not cb.is_settled)   as next_unpaid_due_date
from app.charge_balance cb
where cb.contract_id is not null
group by cb.org_id, cb.contract_id;

-- ---------------------------------------------------------------------------
-- unit_financial — per-unit rollup across its contracts/charges.
-- ---------------------------------------------------------------------------
create view app.unit_financial
  with (security_invoker = true) as
select
  cb.org_id,
  cb.unit_id,
  sum(cb.gross_halalas)     as total_due_halalas,
  sum(cb.allocated_halalas) as total_paid_halalas,
  sum(cb.balance_halalas)   as balance_halalas,
  sum(case when cb.is_overdue then cb.balance_halalas else 0 end) as overdue_halalas
from app.charge_balance cb
where cb.unit_id is not null
group by cb.org_id, cb.unit_id;

-- ---------------------------------------------------------------------------
-- payment_status — how much of each payment is still unallocated (a credit / on-account balance).
-- ---------------------------------------------------------------------------
create view app.payment_status
  with (security_invoker = true) as
select
  p.id                                        as payment_id,
  p.org_id,
  p.party_id,
  p.amount_halalas,
  coalesce(x.allocated_halalas, 0)            as allocated_halalas,
  p.amount_halalas - coalesce(x.allocated_halalas, 0) as unallocated_halalas
from app.payment p
left join (
  select payment_id, sum(amount_halalas) as allocated_halalas
  from app.payment_allocation
  group by payment_id
) x on x.payment_id = p.id
where p.deleted_at is null;

grant select on app.charge_balance, app.contract_financial, app.unit_financial, app.payment_status
  to authenticated, service_role;

-- ================================================================
-- 0016_import_functions.sql
-- ================================================================
-- 0016_import_functions.sql
-- Excel import: validate (normalize + per-field errors + reference resolution), commit (create
-- entities, stamp what each row created), revert (soft-delete a whole batch). SCHEMA.md §11.
-- SECURITY INVOKER: the caller must be an active member of the batch's org — RLS confines every
-- read/write to that org, and entity creation passes the same WITH CHECK gates as manual entry.

-- ---------- small mappers (Arabic label -> enum) ----------
create or replace function app.map_property_kind(p text) returns app.property_kind
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'سكني' then 'residential' when 'تجاري' then 'commercial'
    when 'مختلط' then 'mixed_use'  when 'أرض' then 'land' when 'ارض' then 'land'
    else 'residential' end::app.property_kind;
$$;

create or replace function app.map_unit_status(p text) returns app.unit_status
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'شاغرة' then 'vacant' when 'مؤجرة' then 'rented' when 'محجوزة' then 'reserved'
    when 'تحت الصيانة' then 'under_maintenance' when 'غير صالحة للتأجير' then 'not_rentable'
    when 'خارج الخدمة' then 'out_of_service' else 'vacant' end::app.unit_status;
$$;

create or replace function app.map_charge_type(p text) returns app.charge_type
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'إيجار سكني' then 'residential_rent' when 'إيجار تجاري' then 'commercial_rent'
    when 'خدمات' then 'service_fee' when 'تأمين' then 'insurance'
    when 'رسوم إدارية' then 'admin_fee' when 'تأمين مسترد' then 'security_deposit'
    else null end::app.charge_type;
$$;

create or replace function app.map_payment_frequency(p text) returns app.payment_frequency
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'شهري' then 'monthly' when 'ربع سنوي' then 'quarterly'
    when 'نصف سنوي' then 'semi_annual' when 'سنوي' then 'annual'
    when 'دفعة واحدة' then 'one_time' else 'quarterly' end::app.payment_frequency;
$$;

create or replace function app.map_legal_kind(p text) returns app.legal_kind
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'شركة' then 'company' when 'مؤسسة' then 'company' else 'individual' end::app.legal_kind;
$$;

create or replace function app.import_err(p_field text, p_value text, p_reason text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('field', p_field, 'value', p_value, 'reason', p_reason);
$$;

create or replace function app.self_owner_id(p_org uuid) returns uuid
language sql stable as $$
  select id from app.owner where org_id = p_org and is_self and deleted_at is null limit 1;
$$;

-- ===========================================================================
-- import_validate — normalize every row, collect per-field errors, resolve references.
-- ===========================================================================
create or replace function app.import_validate(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  r      app.import_row;
  norm   jsonb;
  errs   jsonb;
  s      text;
  amt    bigint;
  ph     text;
  d1     date;
  d2     date;
  ref_id uuid;
  ref2   uuid;
  n_valid int := 0;
  n_error int := 0;
  n_total int := 0;
begin
  select org_id, kind into v_org, v_kind from app.import_batch where id = p_batch;
  if v_org is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch order by row_number loop
    norm := '{}'::jsonb;
    errs := '[]'::jsonb;
    n_total := n_total + 1;

    if v_kind = 'properties' then
      s := nullif(trim(r.raw->>'اسم العقار'), '');
      if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('name', s); end if;
      norm := norm || jsonb_build_object(
        'property_kind', app.map_property_kind(r.raw->>'نوع العقار'),
        'deed_number',   nullif(trim(r.raw->>'رقم الصك'), ''),
        'city',          nullif(trim(r.raw->>'المدينة'), ''),
        'district',      nullif(trim(r.raw->>'الحي'), ''),
        'address_line',  nullif(trim(r.raw->>'العنوان'), ''),
        'owner_name',    nullif(trim(r.raw->>'اسم المالك'), ''));

    elsif v_kind = 'owners' then
      s := nullif(trim(r.raw->>'الاسم'), '');
      if s is null then errs := errs || app.import_err('الاسم', r.raw->>'الاسم', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('display_name', s); end if;
      ph := r.raw->>'الجوال';
      if ph is not null and trim(ph) <> '' then
        if app.normalize_phone_e164(ph) is null
          then errs := errs || app.import_err('الجوال', ph, 'رقم جوال غير صالح');
          else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(ph), 'phone_raw', ph);
        end if;
      end if;
      norm := norm || jsonb_build_object(
        'legal_kind', app.map_legal_kind(r.raw->>'النوع'),
        'national_id', nullif(trim(r.raw->>'رقم الهوية'), ''),
        'iban', nullif(trim(r.raw->>'الآيبان'), ''),
        'bank_name', nullif(trim(r.raw->>'البنك'), ''));

    elsif v_kind = 'tenants' then
      s := nullif(trim(r.raw->>'الاسم'), '');
      if s is null then errs := errs || app.import_err('الاسم', r.raw->>'الاسم', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('display_name', s); end if;
      ph := coalesce(r.raw->>'الجوال', '');
      if trim(ph) <> '' then
        if app.normalize_phone_e164(ph) is null
          then errs := errs || app.import_err('الجوال', ph, 'رقم جوال غير صالح');
          else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(ph), 'phone_raw', ph);
        end if;
      end if;
      norm := norm || jsonb_build_object(
        'legal_kind', app.map_legal_kind(r.raw->>'النوع'),
        'national_id', nullif(trim(coalesce(r.raw->>'رقم الهوية', r.raw->>'رقم الإقامة')), ''),
        'email', nullif(trim(r.raw->>'البريد الإلكتروني'), ''));

    elsif v_kind = 'units' then
      s := nullif(trim(r.raw->>'اسم العقار'), '');
      if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
      else
        select id into ref_id from app.property
          where org_id = v_org and name = s and deleted_at is null limit 1;
        if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود في المنصة');
        else norm := norm || jsonb_build_object('property_id', ref_id); end if;
      end if;
      s := nullif(trim(r.raw->>'رقم الوحدة'), '');
      if s is null then errs := errs || app.import_err('رقم الوحدة', r.raw->>'رقم الوحدة', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('unit_number', s); end if;
      norm := norm || jsonb_build_object(
        'floor', nullif(trim(r.raw->>'الدور'), ''),
        'area_sqm', nullif(app.fold_digits(r.raw->>'المساحة'), ''),
        'current_status', app.map_unit_status(r.raw->>'الحالة'));

    elsif v_kind = 'contracts' then
      s := nullif(trim(r.raw->>'رقم العقد'), '');
      if s is null then errs := errs || app.import_err('رقم العقد', r.raw->>'رقم العقد', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('contract_number', s); end if;
      -- property
      s := nullif(trim(r.raw->>'اسم العقار'), '');
      select id into ref_id from app.property where org_id = v_org and name = s and deleted_at is null limit 1;
      if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود');
      else
        norm := norm || jsonb_build_object('property_id', ref_id);
        -- unit within property
        s := nullif(trim(r.raw->>'رقم الوحدة'), '');
        select id into ref2 from app.unit where property_id = ref_id and unit_number = s and deleted_at is null limit 1;
        if ref2 is null then errs := errs || app.import_err('رقم الوحدة', s, 'الوحدة غير موجودة في هذا العقار');
        else norm := norm || jsonb_build_object('unit_id', ref2); end if;
      end if;
      -- tenant by national id or name
      s := nullif(trim(r.raw->>'رقم هوية المستأجر'), '');
      ref_id := null;
      if s is not null then
        select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
          where t.org_id = v_org and p.national_id = s and t.deleted_at is null limit 1;
      end if;
      if ref_id is null then
        s := nullif(trim(r.raw->>'اسم المستأجر'), '');
        select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
          where t.org_id = v_org and p.display_name = s and t.deleted_at is null limit 1;
      end if;
      if ref_id is null then errs := errs || app.import_err('المستأجر', coalesce(r.raw->>'اسم المستأجر', r.raw->>'رقم هوية المستأجر'), 'المستأجر غير موجود');
      else norm := norm || jsonb_build_object('tenant_id', ref_id); end if;
      -- dates
      d1 := app.normalize_date(r.raw->>'تاريخ البداية');
      d2 := app.normalize_date(r.raw->>'تاريخ النهاية');
      if d1 is null then errs := errs || app.import_err('تاريخ البداية', r.raw->>'تاريخ البداية', 'تاريخ غير صالح');
      else norm := norm || jsonb_build_object('start_date', d1); end if;
      if d2 is null then errs := errs || app.import_err('تاريخ النهاية', r.raw->>'تاريخ النهاية', 'تاريخ غير صالح');
      else norm := norm || jsonb_build_object('end_date', d2); end if;
      if d1 is not null and d2 is not null and d2 < d1 then
        errs := errs || app.import_err('تاريخ النهاية', d2::text, 'تاريخ النهاية قبل البداية');
      end if;
      -- amounts
      amt := app.normalize_amount_halalas(r.raw->>'الإيجار السنوي');
      if amt is null then errs := errs || app.import_err('الإيجار السنوي', r.raw->>'الإيجار السنوي', 'مبلغ غير صالح');
      else norm := norm || jsonb_build_object('annual_rent_halalas', amt); end if;
      norm := norm || jsonb_build_object(
        'deposit_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'التأمين'), 0),
        'service_fees_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'رسوم الخدمات'), 0),
        'payment_frequency', app.map_payment_frequency(r.raw->>'دورية الدفع'),
        'ejar_contract_number', nullif(trim(r.raw->>'رقم عقد إيجار'), ''),
        'deed_number', nullif(trim(r.raw->>'رقم الصك'), ''));

    elsif v_kind = 'charges' then
      s := nullif(trim(r.raw->>'رقم العقد'), '');
      select id into ref_id from app.contract
        where org_id = v_org and contract_number = s and deleted_at is null limit 1;
      if ref_id is null then errs := errs || app.import_err('رقم العقد', s, 'العقد غير موجود');
      else
        norm := norm || jsonb_build_object('contract_id', ref_id);
        norm := norm || (select jsonb_build_object('property_id', property_id, 'unit_id', unit_id)
                         from app.contract where id = ref_id);
      end if;
      if app.map_charge_type(r.raw->>'نوع الاستحقاق') is null then
        errs := errs || app.import_err('نوع الاستحقاق', r.raw->>'نوع الاستحقاق', 'نوع غير معروف');
      else norm := norm || jsonb_build_object('charge_type', app.map_charge_type(r.raw->>'نوع الاستحقاق')); end if;
      d1 := app.normalize_date(r.raw->>'تاريخ الاستحقاق');
      if d1 is null then errs := errs || app.import_err('تاريخ الاستحقاق', r.raw->>'تاريخ الاستحقاق', 'تاريخ غير صالح');
      else norm := norm || jsonb_build_object('due_date', d1); end if;
      amt := app.normalize_amount_halalas(r.raw->>'المبلغ قبل الضريبة');
      if amt is null then errs := errs || app.import_err('المبلغ قبل الضريبة', r.raw->>'المبلغ قبل الضريبة', 'مبلغ غير صالح');
      else
        norm := norm || jsonb_build_object('amount_excl_vat_halalas', amt);
        -- VAT rate defaults to 0 for residential rent; caller may override via 'نسبة الضريبة'
        declare v_rate numeric(5,4) := coalesce(nullif(app.fold_digits(r.raw->>'نسبة الضريبة'), '')::numeric, 0);
        begin
          norm := norm || jsonb_build_object(
            'vat_rate', v_rate,
            'vat_amount_halalas', round(amt * v_rate)::bigint);
        end;
      end if;
      norm := norm || jsonb_build_object('description', nullif(trim(r.raw->>'الوصف'), ''));
    end if;

    update app.import_row
      set normalized = norm, errors = errs, is_valid = (jsonb_array_length(errs) = 0)
      where id = r.id;
    if jsonb_array_length(errs) = 0 then n_valid := n_valid + 1; else n_error := n_error + 1; end if;
  end loop;

  update app.import_batch
    set status = 'validated', total_rows = n_total, valid_rows = n_valid, error_rows = n_error
    where id = p_batch;
end;
$$;

-- ===========================================================================
-- import_commit — insert entities for every VALID row; stamp created_entity for revert.
-- Runs in the caller's transaction; a single failure rolls the whole thing back.
-- ===========================================================================
create or replace function app.import_commit(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  v_status app.import_status;
  r      app.import_row;
  n      jsonb;
  new_id uuid;
  v_party uuid;
  v_owner uuid;
begin
  select org_id, kind, status into v_org, v_kind, v_status from app.import_batch where id = p_batch;
  if v_org is null then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if v_status <> 'validated' then
    raise exception 'IMPORT_NOT_VALIDATED: run import_validate first' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch and is_valid order by row_number loop
    n := r.normalized;

    if v_kind = 'properties' then
      -- resolve owner: explicit owner_name → find-or-create; else self owner
      if coalesce(n->>'owner_name', '') <> '' then
        select o.id into v_owner from app.owner o join app.party p on p.id = o.party_id
          where o.org_id = v_org and p.display_name = n->>'owner_name' and o.deleted_at is null limit 1;
        if v_owner is null then
          insert into app.party (org_id, display_name, roles) values (v_org, n->>'owner_name', array['owner']::app.party_role[])
            returning id into v_party;
          insert into app.owner (org_id, party_id) values (v_org, v_party) returning id into v_owner;
        end if;
      else
        v_owner := app.self_owner_id(v_org);
      end if;
      insert into app.property (org_id, owner_id, name, property_kind, deed_number, city, district, address_line)
      values (v_org, v_owner, n->>'name', (n->>'property_kind')::app.property_kind,
              n->>'deed_number', n->>'city', n->>'district', n->>'address_line')
      returning id into new_id;
      update app.import_row set created_entity_type = 'property', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'owners' then
      insert into app.party (org_id, display_name, legal_kind, national_id, phone_e164, phone_raw, roles)
      values (v_org, n->>'display_name', (n->>'legal_kind')::app.legal_kind, n->>'national_id',
              n->>'phone_e164', n->>'phone_raw', array['owner']::app.party_role[])
      returning id into v_party;
      insert into app.owner (org_id, party_id, owner_kind, iban, bank_name)
      values (v_org, v_party, (n->>'legal_kind')::app.legal_kind, n->>'iban', n->>'bank_name')
      returning id into new_id;
      update app.import_row set created_entity_type = 'owner', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'tenants' then
      insert into app.party (org_id, display_name, legal_kind, national_id, phone_e164, phone_raw, email, roles)
      values (v_org, n->>'display_name', (n->>'legal_kind')::app.legal_kind, n->>'national_id',
              n->>'phone_e164', n->>'phone_raw', (n->>'email')::citext, array['tenant']::app.party_role[])
      returning id into v_party;
      insert into app.tenant (org_id, party_id, tenant_kind)
      values (v_org, v_party, (n->>'legal_kind')::app.legal_kind)
      returning id into new_id;
      update app.import_row set created_entity_type = 'tenant', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'units' then
      insert into app.unit (org_id, property_id, unit_number, floor, area_sqm, current_status)
      values (v_org, (n->>'property_id')::uuid, n->>'unit_number', n->>'floor',
              nullif(n->>'area_sqm', '')::numeric, (n->>'current_status')::app.unit_status)
      returning id into new_id;
      update app.import_row set created_entity_type = 'unit', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'contracts' then
      insert into app.contract (org_id, property_id, unit_id, tenant_id, contract_number,
                                ejar_contract_number, deed_number, start_date, end_date,
                                annual_rent_halalas, payment_frequency, deposit_halalas, service_fees_halalas,
                                status)
      values (v_org, (n->>'property_id')::uuid, (n->>'unit_id')::uuid, (n->>'tenant_id')::uuid,
              n->>'contract_number', n->>'ejar_contract_number', n->>'deed_number',
              (n->>'start_date')::date, (n->>'end_date')::date,
              (n->>'annual_rent_halalas')::bigint, (n->>'payment_frequency')::app.payment_frequency,
              (n->>'deposit_halalas')::bigint, (n->>'service_fees_halalas')::bigint, 'draft')
      returning id into new_id;
      update app.import_row set created_entity_type = 'contract', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'charges' then
      insert into app.charge (org_id, property_id, unit_id, contract_id, charge_type, due_date,
                              amount_excl_vat_halalas, vat_rate, vat_amount_halalas, description)
      values (v_org, (n->>'property_id')::uuid, nullif(n->>'unit_id','')::uuid, (n->>'contract_id')::uuid,
              (n->>'charge_type')::app.charge_type, (n->>'due_date')::date,
              (n->>'amount_excl_vat_halalas')::bigint, (n->>'vat_rate')::numeric,
              (n->>'vat_amount_halalas')::bigint, n->>'description')
      returning id into new_id;
      update app.import_row set created_entity_type = 'charge', created_entity_id = new_id where id = r.id;
    end if;
  end loop;

  update app.import_batch set status = 'committed', committed_at = now() where id = p_batch;
  perform app.write_audit(v_org, 'import.commit', 'import_batch', p_batch,
                          jsonb_build_object('kind', v_kind));
end;
$$;

-- ===========================================================================
-- import_revert — soft-delete everything a committed batch created (whole-batch undo). §11.
-- ===========================================================================
create or replace function app.import_revert(p_batch uuid, p_reason text default 'import_revert') returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org uuid;
  r     app.import_row;
begin
  select org_id into v_org from app.import_batch where id = p_batch and status = 'committed';
  if v_org is null then
    raise exception 'IMPORT_NOT_COMMITTED' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch and created_entity_id is not null loop
    execute format(
      'update app.%I set deleted_at = now(), deleted_by = %L, deleted_reason = %L where id = %L',
      r.created_entity_type, auth.uid(), p_reason, r.created_entity_id);
  end loop;

  update app.import_batch set status = 'reverted', reverted_at = now(), reverted_by = auth.uid()
    where id = p_batch;
  perform app.write_audit(v_org, 'import.revert', 'import_batch', p_batch, '{}'::jsonb);
end;
$$;

grant execute on function app.import_validate(uuid) to authenticated, service_role;
grant execute on function app.import_commit(uuid)   to authenticated, service_role;
grant execute on function app.import_revert(uuid, text) to authenticated, service_role;

-- ================================================================
-- 0017_identity_auth_users.sql
-- ================================================================
-- 0017_identity_auth_users.sql
-- Bind our global Identity to Supabase Auth (GoTrue). Decision: use Supabase Auth for phone OTP;
-- app.identity becomes a 1:1 profile of auth.users (identity.id = auth.users.id = auth.uid()), so the
-- RLS that keys on auth.uid() works natively. A trigger auto-creates the identity profile on signup.
--
-- Supabase-safe / CI-safe: the FK and the trigger on auth.users are only installed when auth.users
-- exists (Supabase). On bare Postgres (local tests) this migration is a no-op except for defining the
-- function, so the existing suite keeps passing.

-- Profile creator: runs on every new auth.users row. Normalizes the phone to strict E.164 and
-- inserts the identity with the SAME id. SECURITY DEFINER so it can write app.identity.
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text;
begin
  v_phone := app.normalize_phone_e164(new.phone);
  -- Phone-first: only provision an identity when we have a valid KSA mobile (the global key).
  if v_phone is not null then
    insert into app.identity (id, phone_e164, phone_raw, email)
    values (new.id, v_phone, new.phone, new.email)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

do $do$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    -- 1:1 link identity.id -> auth.users.id
    if not exists (select 1 from pg_constraint where conname = 'identity_auth_user_fk') then
      execute 'alter table app.identity
                 add constraint identity_auth_user_fk
                 foreign key (id) references auth.users(id) on delete cascade';
    end if;

    -- Auto-provision the profile on signup.
    execute 'drop trigger if exists on_auth_user_created on auth.users';
    execute 'create trigger on_auth_user_created
               after insert on auth.users
               for each row execute function app.handle_new_auth_user()';
  end if;
end
$do$;

-- ================================================================
-- 0018_org_visibility.sql
-- ================================================================
-- 0018_org_visibility.sql
-- The org switcher must list the organizations a user belongs to BEFORE any active org is chosen
-- (chicken-and-egg: you can't pick an org you can't see). We let a signed-in user SELECT the
-- organization rows where they hold an active membership — independent of the x-active-org context.
--
-- Isolation is preserved: this only exposes orgs the caller is actually a member of, and it only
-- affects the `organization` table (name/type). All data INSIDE an org stays gated by
-- has_org_access(active org). Idempotent (re-runnable on the live DB).

create or replace function app.is_member_of(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.membership m
    where m.org_id = p_org
      and m.identity_id = auth.uid()
      and m.status = 'active'
      and m.deleted_at is null
  );
$$;
revoke all on function app.is_member_of(uuid) from public;
grant execute on function app.is_member_of(uuid) to authenticated, service_role;

-- Was: using (app.has_org_access(id)) — too strict (only the currently-active org was visible).
drop policy if exists organization_select on app.organization;
create policy organization_select on app.organization for select
  using (app.is_member_of(id));

-- ================================================================
-- 0019_contract_ops.sql
-- ================================================================
-- 0019_contract_ops.sql
-- Atomic contract operations (business logic lives in the DB so it's transactional and RLS-covered):
--   * activate_contract: draft → active, generate the rent charge schedule, mark the unit rented.
--   * record_charge_payment: create a payment and allocate it to a charge (capped at the balance).
-- SECURITY INVOKER: runs as the caller, so RLS + the x-active-org context apply on every write.
-- Idempotent (create or replace); safe to run on the live DB.

-- ---------------------------------------------------------------------------
-- activate_contract(contract_id)
-- Frequency → number of periods and month step. Rent is split evenly (remainder on the last charge).
-- VAT: residential rent is exempt (0); commercial rent is 15%. The one-active-contract-per-unit
-- partial index enforces exclusivity; any failure rolls the whole activation back.
-- ---------------------------------------------------------------------------
create or replace function app.activate_contract(p_contract uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  c          app.contract;
  v_periods  int;
  v_interval int;
  v_base     bigint;
  v_rem      bigint;
  v_rate     numeric(5,4);
  v_type     app.charge_type;
  v_excl     bigint;
  i          int;
begin
  select * into c from app.contract where id = p_contract and deleted_at is null;
  if c.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if c.status <> 'draft' then raise exception 'CONTRACT_NOT_DRAFT: only draft contracts can be activated' using errcode = 'raise_exception'; end if;

  -- Activate first so the one-active-per-unit index rejects duplicates before we create charges.
  update app.contract set status = 'active', activated_at = now() where id = c.id;

  case c.payment_frequency
    when 'monthly'     then v_periods := 12; v_interval := 1;
    when 'quarterly'   then v_periods := 4;  v_interval := 3;
    when 'semi_annual' then v_periods := 2;  v_interval := 6;
    when 'annual'      then v_periods := 1;  v_interval := 12;
    else                    v_periods := 1;  v_interval := 0;   -- one_time / custom
  end case;

  v_base := c.annual_rent_halalas / v_periods;
  v_rem  := c.annual_rent_halalas - v_base * v_periods;

  if c.contract_kind = 'commercial' then
    v_rate := 0.15; v_type := 'commercial_rent';
  else
    v_rate := 0;    v_type := 'residential_rent';
  end if;

  for i in 0 .. v_periods - 1 loop
    v_excl := v_base + case when i = v_periods - 1 then v_rem else 0 end;
    insert into app.charge (
      org_id, property_id, unit_id, contract_id, charge_type, due_date,
      amount_excl_vat_halalas, vat_rate, vat_amount_halalas, description
    ) values (
      c.org_id, c.property_id, c.unit_id, c.id, v_type,
      (c.start_date + (i * v_interval) * interval '1 month')::date,
      v_excl, v_rate, round(v_excl * v_rate),
      'دفعة إيجار ' || (i + 1) || '/' || v_periods
    );
  end loop;

  update app.unit set current_status = 'rented' where id = c.unit_id;

  perform app.write_audit(c.org_id, 'contract.activate', 'contract', c.id,
                          jsonb_build_object('periods', v_periods));
end;
$$;

-- ---------------------------------------------------------------------------
-- record_charge_payment(charge_id, amount_halalas, method)
-- Creates a payment from the contract's tenant and allocates min(amount, remaining balance) to the
-- charge. Any excess stays as an unallocated on-account credit on the payment.
-- ---------------------------------------------------------------------------
create or replace function app.record_charge_payment(
  p_charge uuid,
  p_amount_halalas bigint,
  p_method app.payment_method default 'cash'
) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  ch        app.charge;
  v_party   uuid;
  v_balance bigint;
  v_alloc   bigint;
  v_pay     uuid;
begin
  if p_amount_halalas is null or p_amount_halalas <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception';
  end if;

  select * into ch from app.charge where id = p_charge and deleted_at is null;
  if ch.id is null then raise exception 'CHARGE_NOT_FOUND' using errcode = 'raise_exception'; end if;

  select ch.amount_incl_vat_halalas - coalesce(sum(a.amount_halalas), 0)
    into v_balance
  from app.payment_allocation a where a.charge_id = ch.id;

  select t.party_id into v_party
  from app.contract c join app.tenant t on t.id = c.tenant_id
  where c.id = ch.contract_id;

  insert into app.payment (org_id, party_id, method, amount_halalas)
  values (ch.org_id, v_party, p_method, p_amount_halalas)
  returning id into v_pay;

  v_alloc := least(p_amount_halalas, greatest(v_balance, 0));
  if v_alloc > 0 then
    insert into app.payment_allocation (org_id, payment_id, charge_id, amount_halalas)
    values (ch.org_id, v_pay, ch.id, v_alloc);
  end if;

  perform app.write_audit(ch.org_id, 'payment.record', 'charge', ch.id,
                          jsonb_build_object('amount', p_amount_halalas, 'allocated', v_alloc));
end;
$$;

revoke all on function app.activate_contract(uuid) from public;
revoke all on function app.record_charge_payment(uuid, bigint, app.payment_method) from public;
grant execute on function app.activate_contract(uuid) to authenticated, service_role;
grant execute on function app.record_charge_payment(uuid, bigint, app.payment_method) to authenticated, service_role;

-- ================================================================
-- 0020_owner_statement.sql
-- ================================================================
-- 0020_owner_statement.sql
-- Owner account statement: for the owner's properties over a period, aggregate what was COLLECTED
-- (payments allocated to those properties' charges, by payment received_at), the management fee
-- (from the owner's percentage_of_collection ManagementAgreement, if any), the net due to the owner,
-- and the outstanding balance. SECURITY INVOKER so RLS + property scope apply to the caller.
-- Idempotent; no new tables.

create or replace function app.owner_statement(p_owner uuid, p_from date, p_to date)
returns table (
  property_id        uuid,
  property_name      text,
  collected_halalas  bigint,
  outstanding_halalas bigint,
  fee_halalas        bigint,
  net_halalas        bigint
)
language sql stable security invoker set search_path = app, pg_temp as $$
  with pct as (
    -- the owner's active percentage-of-collection fee that overlaps the period (0 if none)
    select coalesce(max(fee_percentage), 0)::numeric as p
    from app.management_agreement
    where owner_id = p_owner
      and fee_model = 'percentage_of_collection'
      and deleted_at is null
      and valid_from <= p_to
      and (valid_to is null or valid_to >= p_from)
  ),
  props as (
    select id, name from app.property where owner_id = p_owner and deleted_at is null
  ),
  collected as (
    select c.property_id, sum(a.amount_halalas)::bigint as amt
    from app.payment_allocation a
    join app.payment p on p.id = a.payment_id and p.deleted_at is null
    join app.charge  c on c.id = a.charge_id
    where c.property_id in (select id from props)
      and p.received_at::date between p_from and p_to
    group by c.property_id
  ),
  outstanding as (
    select cb.property_id, sum(cb.balance_halalas)::bigint as bal
    from app.charge_balance cb
    where cb.property_id in (select id from props)
    group by cb.property_id
  )
  select
    pr.id,
    pr.name,
    coalesce(col.amt, 0),
    coalesce(o.bal, 0),
    round(coalesce(col.amt, 0) * (select p from pct))::bigint,
    (coalesce(col.amt, 0) - round(coalesce(col.amt, 0) * (select p from pct)))::bigint
  from props pr
  left join collected  col on col.property_id = pr.id
  left join outstanding o   on o.property_id  = pr.id
  order by pr.name;
$$;

revoke all on function app.owner_statement(uuid, date, date) from public;
grant execute on function app.owner_statement(uuid, date, date) to authenticated, service_role;

-- ================================================================
-- 0021_dashboard_kpis.sql
-- ================================================================
-- 0021_dashboard_kpis.sql
-- Office dashboard finance aggregates in ONE row for the caller's active org.
-- Money SUMS live here because PostgREST disables aggregate functions over the REST API; the plain
-- counts (properties / units / contracts) are cheap head-count queries done in the app layer.
--
-- SECURITY INVOKER: RLS on app.charge_balance and app.payment scopes every sum to the caller's
-- active org (x-active-org header → current_org_id()). Same pattern as app.owner_statement (0020).
-- Month boundaries are computed in Asia/Riyadh so "this month" matches the office's local calendar.

create or replace function app.dashboard_finance()
returns table (
  outstanding_halalas      bigint,   -- total unpaid balance across all charges (receivable)
  overdue_halalas          bigint,   -- portion of the above whose due_date has passed
  overdue_charges          bigint,   -- how many charges are overdue
  collected_month_halalas  bigint,   -- payments received since the 1st of the current month
  collected_prev_halalas   bigint    -- payments received in the previous calendar month (for a trend)
)
language sql
stable
security invoker
set search_path = app, pg_temp
as $$
  with tz as (
    select date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date as month_start
  ),
  bounds as (
    select
      month_start,
      (month_start - interval '1 month')::date as prev_start
    from tz
  ),
  outstanding as (
    select
      coalesce(sum(cb.balance_halalas), 0)::bigint                            as bal,
      coalesce(sum(cb.balance_halalas) filter (where cb.is_overdue), 0)::bigint as overdue,
      coalesce(count(*) filter (where cb.is_overdue), 0)::bigint              as overdue_n
    from app.charge_balance cb
    where cb.balance_halalas > 0
  ),
  pay as (
    select
      coalesce(sum(p.amount_halalas) filter (
        where (p.received_at at time zone 'Asia/Riyadh')::date >= (select month_start from bounds)
      ), 0)::bigint as this_month,
      coalesce(sum(p.amount_halalas) filter (
        where (p.received_at at time zone 'Asia/Riyadh')::date >= (select prev_start  from bounds)
          and (p.received_at at time zone 'Asia/Riyadh')::date <  (select month_start from bounds)
      ), 0)::bigint as prev_month
    from app.payment p
    where p.deleted_at is null
  )
  select o.bal, o.overdue, o.overdue_n, pay.this_month, pay.prev_month
  from outstanding o cross join pay;
$$;

grant execute on function app.dashboard_finance() to authenticated, service_role;

-- ================================================================
-- 0022_receipt_vouchers.sql
-- ================================================================
-- 0022_receipt_vouchers.sql
-- سند القبض (receipt voucher): every payment gets a stable, gapless-per-(org,year) receipt number so
-- there is a numbered proof of collection — essential for cash, and to tie a bank transfer to the
-- exact contract/charges it settled. A receipt documents money RECEIVED; it is NOT the ZATCA tax
-- invoice (which documents the supply + VAT). The two are deliberately separate, mirroring the
-- charge (invoiceable) vs payment (collection) split already in the schema.
--
-- Numbering: a per-org, per-kind counter (app.org_counter). Receipts use kind = 'receipt:<year>' so
-- each calendar year restarts at 1 and stays gapless. The counter also serves future doc types
-- (tax invoices, credit notes) without new plumbing.
-- Idempotent where practical; safe to run once on the live DB.

-- ---------------------------------------------------------------------------
-- Per-org document counters.
-- ---------------------------------------------------------------------------
create table if not exists app.org_counter (
  org_id  uuid   not null references app.organization(id) on delete cascade,
  kind    text   not null,
  value   bigint not null default 0,
  primary key (org_id, kind)
);

alter table app.org_counter enable row level security;

-- Readable within the active org; writes only ever happen through app.next_counter (definer).
drop policy if exists org_counter_select on app.org_counter;
create policy org_counter_select on app.org_counter
  for select using (app.has_org_access(org_id));

-- ---------------------------------------------------------------------------
-- next_counter(org, kind) → the next gapless value, atomically. The row lock from the upsert
-- serializes concurrent callers so no two payments share a number.
-- SECURITY DEFINER so it owns the counter writes (callers can't move counters arbitrarily); the
-- org is always supplied by a trigger from an already-RLS-validated row.
-- ---------------------------------------------------------------------------
create or replace function app.next_counter(p_org uuid, p_kind text)
returns bigint
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v bigint;
begin
  insert into app.org_counter (org_id, kind, value)
  values (p_org, p_kind, 1)
  on conflict (org_id, kind)
    do update set value = app.org_counter.value + 1
  returning value into v;
  return v;
end;
$$;

revoke all on function app.next_counter(uuid, text) from public;
grant execute on function app.next_counter(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Receipt columns on payment + trigger to assign on insert (covers every insert path: the
-- record_charge_payment RPC, imports, and any direct insert).
-- ---------------------------------------------------------------------------
alter table app.payment add column if not exists receipt_seq bigint;
alter table app.payment add column if not exists receipt_no  text;

create unique index if not exists payment_receipt_no_uniq
  on app.payment (org_id, receipt_no) where receipt_no is not null;

create or replace function app.tg_assign_receipt_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year text;
begin
  if new.receipt_seq is null then
    v_year := to_char((coalesce(new.received_at, now())) at time zone 'Asia/Riyadh', 'YYYY');
    new.receipt_seq := app.next_counter(new.org_id, 'receipt:' || v_year);
    new.receipt_no  := 'RV-' || v_year || '-' || lpad(new.receipt_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists payment_assign_receipt on app.payment;
create trigger payment_assign_receipt
  before insert on app.payment
  for each row execute function app.tg_assign_receipt_no();

-- ---------------------------------------------------------------------------
-- Backfill existing payments in chronological order, per org and per received-year.
-- ---------------------------------------------------------------------------
do $$
declare
  r    record;
  s    bigint;
  yr   text;
begin
  for r in
    select id, org_id, received_at
    from app.payment
    where receipt_seq is null
    order by org_id, received_at, created_at
  loop
    yr := to_char(r.received_at at time zone 'Asia/Riyadh', 'YYYY');
    s  := app.next_counter(r.org_id, 'receipt:' || yr);
    update app.payment
      set receipt_seq = s,
          receipt_no  = 'RV-' || yr || '-' || lpad(s::text, 5, '0')
    where id = r.id;
  end loop;
end $$;

-- ================================================================
-- 0023_tax_invoice.sql
-- ================================================================
-- 0023_tax_invoice.sql
-- ZATCA Phase-1 (Generation) tax invoice. An invoice documents the SUPPLY + VAT and is issued at the
-- tax point regardless of payment (payment is tracked separately via payment/allocation). This is the
-- deliberate counterpart to the receipt voucher (0022): receipt = money received, invoice = supply.
--
-- MVP: one invoice per charge (a rent installment). The invoice SNAPSHOTS the supplier and buyer at
-- issue time so it is immutable even if their records later change. Numbering reuses the per-org
-- counter (0022) with kind = 'invoice:<year>' → INV-YYYY-NNNNN, gapless per (org, year).
--
-- Mixed VAT registration: the supplier of a rent supply is the OWNER (the office issues as its agent),
-- or the ORG itself for self-owned property. If that supplier has a VAT number → a tax/simplified
-- invoice (with QR, built in the app layer from these fields). If not → a 'plain' invoice (no VAT
-- claim, no QR). residential rent is VAT-exempt (0%, with an exemption reason); commercial is 15%.
-- The QR TLV/crypto stamp and Phase-2 clearance are added later; the snapshot fields here are what a
-- Phase-1 QR needs, and leave room for Phase-2 (uuid/hash/signature) without reshaping.

-- ---------------------------------------------------------------------------
-- Supplier tax identity for real owners (org already has vat_number/cr_number).
-- ---------------------------------------------------------------------------
alter table app.owner add column if not exists vat_number text;
alter table app.owner add column if not exists cr_number  text;

-- ---------------------------------------------------------------------------
-- Invoice (header) — snapshot of one issued document.
-- ---------------------------------------------------------------------------
create table if not exists app.invoice (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references app.organization(id) on delete cascade,
  property_id            uuid not null references app.property(id),
  contract_id            uuid references app.contract(id) on delete set null,
  charge_id              uuid references app.charge(id) on delete set null,
  owner_id               uuid references app.owner(id),
  buyer_party_id         uuid references app.party(id),
  invoice_seq            bigint,
  invoice_no             text,
  invoice_type           text not null default 'simplified',  -- simplified | standard | plain
  issue_at               timestamptz not null default now(),
  supply_date            date,
  currency               text not null default 'SAR' check (currency = 'SAR'),
  -- supplier snapshot
  supplier_name          text,
  supplier_vat_number    text,
  supplier_cr_number     text,
  -- buyer snapshot
  buyer_name             text,
  buyer_vat_number       text,
  buyer_id               text,           -- national id / iqama / CR of the buyer
  -- totals (integer halalas)
  total_excl_vat_halalas bigint not null default 0,
  total_vat_halalas      bigint not null default 0,
  total_incl_vat_halalas bigint not null default 0,
  status                 text not null default 'issued',       -- issued | cancelled
  notes                  text,
  created_by             uuid references app.identity(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  deleted_by             uuid,
  deleted_reason         text
);

create index if not exists invoice_org_idx      on app.invoice (org_id) where deleted_at is null;
create index if not exists invoice_contract_idx on app.invoice (contract_id);
-- At most one live issued invoice per charge.
create unique index if not exists invoice_one_per_charge
  on app.invoice (charge_id) where charge_id is not null and status = 'issued' and deleted_at is null;
create unique index if not exists invoice_no_uniq
  on app.invoice (org_id, invoice_no) where invoice_no is not null;

-- ---------------------------------------------------------------------------
-- Invoice line — one per charge for now; the table supports multi-line invoices later.
-- ---------------------------------------------------------------------------
create table if not exists app.invoice_line (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references app.organization(id) on delete cascade,
  invoice_id                  uuid not null references app.invoice(id) on delete cascade,
  charge_id                   uuid references app.charge(id),
  description                 text not null,
  quantity                    numeric(12,2) not null default 1,
  unit_price_excl_vat_halalas bigint not null default 0,
  vat_rate                    numeric(5,4) not null default 0,
  vat_amount_halalas          bigint not null default 0,
  line_excl_vat_halalas       bigint not null default 0,
  line_incl_vat_halalas       bigint not null default 0,
  exemption_reason            text,
  created_at                  timestamptz not null default now()
);

create index if not exists invoice_line_invoice_idx on app.invoice_line (invoice_id);

-- ---------------------------------------------------------------------------
-- Numbering trigger (mirrors the receipt trigger; per org+year, gapless).
-- ---------------------------------------------------------------------------
create or replace function app.tg_assign_invoice_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year text;
begin
  if new.invoice_seq is null then
    v_year := to_char((coalesce(new.issue_at, now())) at time zone 'Asia/Riyadh', 'YYYY');
    new.invoice_seq := app.next_counter(new.org_id, 'invoice:' || v_year);
    new.invoice_no  := 'INV-' || v_year || '-' || lpad(new.invoice_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_assign_no on app.invoice;
create trigger invoice_assign_no
  before insert on app.invoice
  for each row execute function app.tg_assign_invoice_no();

-- updated_at maintenance (reuse the shared helper).
drop trigger if exists invoice_set_updated_at on app.invoice;
create trigger invoice_set_updated_at before update on app.invoice
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- issue_invoice(charge) → invoice id. Snapshots supplier/buyer, copies the charge into one line,
-- rolls up totals, picks the invoice type from whether the supplier is VAT-registered. SECURITY
-- INVOKER so RLS + the x-active-org context apply to every write.
-- ---------------------------------------------------------------------------
create or replace function app.issue_invoice(p_charge uuid)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_temp
as $$
declare
  ch    app.charge;
  ow    app.owner;
  org   app.organization;
  buyer app.party;
  v_sup_name text;
  v_sup_vat  text;
  v_sup_cr   text;
  v_type     text;
  v_exempt   text;
  v_inv      uuid;
begin
  select * into ch from app.charge where id = p_charge and deleted_at is null;
  if ch.id is null then
    raise exception 'CHARGE_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  if exists (select 1 from app.invoice where charge_id = p_charge and status = 'issued' and deleted_at is null) then
    raise exception 'ALREADY_INVOICED: an invoice already exists for this charge' using errcode = 'raise_exception';
  end if;

  select ow2.* into ow
  from app.owner ow2 join app.property pr on pr.owner_id = ow2.id
  where pr.id = ch.property_id;

  select * into org from app.organization where id = ch.org_id;

  if ow.is_self then
    v_sup_name := org.name;
    v_sup_vat  := org.vat_number;
    v_sup_cr   := org.cr_number;
  else
    select display_name into v_sup_name from app.party where id = ow.party_id;
    v_sup_vat := ow.vat_number;
    v_sup_cr  := coalesce(ow.cr_number, (select cr_number from app.party where id = ow.party_id));
  end if;

  select pt.* into buyer
  from app.contract c
  join app.tenant t on t.id = c.tenant_id
  join app.party  pt on pt.id = t.party_id
  where c.id = ch.contract_id;

  v_type := case when v_sup_vat is null then 'plain' else 'simplified' end;
  v_exempt := case when ch.charge_type = 'residential_rent'
                   then 'إيجار سكني — معفى من ضريبة القيمة المضافة' else null end;

  insert into app.invoice (
    org_id, property_id, contract_id, charge_id, owner_id, buyer_party_id,
    invoice_type, issue_at, supply_date,
    supplier_name, supplier_vat_number, supplier_cr_number,
    buyer_name, buyer_vat_number, buyer_id,
    total_excl_vat_halalas, total_vat_halalas, total_incl_vat_halalas, created_by
  ) values (
    ch.org_id, ch.property_id, ch.contract_id, ch.id, ow.id, buyer.id,
    v_type, now(), ch.due_date,
    v_sup_name, v_sup_vat, v_sup_cr,
    buyer.display_name, null, coalesce(buyer.national_id, buyer.iqama_id, buyer.cr_number),
    ch.amount_excl_vat_halalas, ch.vat_amount_halalas, ch.amount_incl_vat_halalas, auth.uid()
  ) returning id into v_inv;

  insert into app.invoice_line (
    org_id, invoice_id, charge_id, description, quantity,
    unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas,
    line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason
  ) values (
    ch.org_id, v_inv, ch.id, coalesce(ch.description, 'إيجار'), 1,
    ch.amount_excl_vat_halalas, ch.vat_rate, ch.vat_amount_halalas,
    ch.amount_excl_vat_halalas, ch.amount_incl_vat_halalas, v_exempt
  );

  perform app.write_audit(ch.org_id, 'invoice.issue', 'invoice', v_inv,
                          jsonb_build_object('charge', ch.id, 'total', ch.amount_incl_vat_halalas));
  return v_inv;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges + RLS. Invoice is property-scoped (mirrors charge); lines are org-scoped (mirror
-- payment_allocation) and always read alongside their already-scoped header.
-- ---------------------------------------------------------------------------
grant select, insert, update on app.invoice, app.invoice_line to authenticated;
grant select, insert, update on app.invoice, app.invoice_line to service_role;

alter table app.invoice      enable row level security;
alter table app.invoice_line enable row level security;

drop policy if exists invoice_all on app.invoice;
create policy invoice_all on app.invoice for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

drop policy if exists invoice_line_all on app.invoice_line;
create policy invoice_line_all on app.invoice_line for all
  using (app.has_org_access(org_id))
  with check (app.has_org_access(org_id));

revoke all on function app.issue_invoice(uuid) from public;
grant execute on function app.issue_invoice(uuid) to authenticated, service_role;

-- ================================================================
-- 0024_credit_debit_notes.sql
-- ================================================================
-- 0024_credit_debit_notes.sql
-- ZATCA credit note (إشعار دائن) and debit note (إشعار مدين). Both are e-invoice documents that
-- REFERENCE a previously issued invoice and carry a reason:
--   * credit note reduces/cancels an invoice (issued in error, early termination, discount, return);
--   * debit note adds an amount to an invoice (extra charge, undercharge correction).
-- A cleared invoice is never edited/deleted — corrections are always a new referencing document.
--
-- These reuse the app.invoice / app.invoice_line tables (a doc_kind discriminator) so numbering,
-- QR, print, and the list all work unchanged. Notes get their own gapless per-(org,year) series:
-- CN-YYYY-NNNNN (credit) and DN-YYYY-NNNNN (debit). Notes carry no charge_id (they reference the
-- original invoice, not a charge), so the one-invoice-per-charge index and re-invoicing are unaffected.

alter table app.invoice add column if not exists doc_kind       text not null default 'invoice';  -- invoice | credit_note | debit_note
alter table app.invoice add column if not exists ref_invoice_id uuid references app.invoice(id);
alter table app.invoice add column if not exists reason         text;

create index if not exists invoice_ref_idx on app.invoice (ref_invoice_id) where ref_invoice_id is not null;

-- ---------------------------------------------------------------------------
-- Numbering: branch the prefix + counter series on doc_kind (invoice series unchanged).
-- ---------------------------------------------------------------------------
create or replace function app.tg_assign_invoice_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year   text;
  v_prefix text;
  v_series text;
begin
  if new.invoice_seq is null then
    v_year := to_char((coalesce(new.issue_at, now())) at time zone 'Asia/Riyadh', 'YYYY');
    v_prefix := case new.doc_kind when 'credit_note' then 'CN' when 'debit_note' then 'DN' else 'INV' end;
    v_series := (case new.doc_kind when 'credit_note' then 'creditnote:' when 'debit_note' then 'debitnote:' else 'invoice:' end) || v_year;
    new.invoice_seq := app.next_counter(new.org_id, v_series);
    new.invoice_no  := v_prefix || '-' || v_year || '-' || lpad(new.invoice_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- issue_credit_note(invoice, reason) → note id. Full reversal: mirrors the original's lines and
-- totals, references it, and marks the original 'cancelled' (which frees its charge to be re-invoiced).
-- ---------------------------------------------------------------------------
create or replace function app.issue_credit_note(p_invoice uuid, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_temp
as $$
declare
  orig   app.invoice;
  v_note uuid;
begin
  select * into orig from app.invoice where id = p_invoice and deleted_at is null;
  if orig.id is null then raise exception 'INVOICE_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if orig.doc_kind <> 'invoice' then
    raise exception 'NOT_AN_INVOICE: only invoices can be credited' using errcode = 'raise_exception';
  end if;
  if orig.status <> 'issued' then
    raise exception 'INVOICE_NOT_ISSUED: already cancelled/credited' using errcode = 'raise_exception';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'raise_exception';
  end if;

  insert into app.invoice (
    org_id, property_id, contract_id, charge_id, owner_id, buyer_party_id,
    doc_kind, ref_invoice_id, reason, invoice_type, issue_at, supply_date,
    supplier_name, supplier_vat_number, supplier_cr_number, buyer_name, buyer_vat_number, buyer_id,
    total_excl_vat_halalas, total_vat_halalas, total_incl_vat_halalas, created_by
  ) values (
    orig.org_id, orig.property_id, orig.contract_id, null, orig.owner_id, orig.buyer_party_id,
    'credit_note', orig.id, p_reason, orig.invoice_type, now(), orig.supply_date,
    orig.supplier_name, orig.supplier_vat_number, orig.supplier_cr_number, orig.buyer_name, orig.buyer_vat_number, orig.buyer_id,
    orig.total_excl_vat_halalas, orig.total_vat_halalas, orig.total_incl_vat_halalas, auth.uid()
  ) returning id into v_note;

  insert into app.invoice_line (
    org_id, invoice_id, charge_id, description, quantity,
    unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas, line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason
  )
  select org_id, v_note, null, description, quantity,
         unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas, line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason
  from app.invoice_line where invoice_id = orig.id;

  update app.invoice set status = 'cancelled' where id = orig.id;

  perform app.write_audit(orig.org_id, 'invoice.credit_note', 'invoice', v_note,
                          jsonb_build_object('ref', orig.id, 'reason', p_reason));
  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- issue_debit_note(invoice, reason, description, amount_excl, vat_rate) → note id.
-- Adds an amount on top of an invoice. Does NOT change the original's status. vat_rate defaults to
-- the original invoice's line rate when omitted.
-- ---------------------------------------------------------------------------
create or replace function app.issue_debit_note(
  p_invoice uuid, p_reason text, p_desc text, p_amount_excl bigint, p_vat_rate numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_temp
as $$
declare
  orig   app.invoice;
  v_note uuid;
  v_rate numeric(5,4);
  v_vat  bigint;
  v_incl bigint;
begin
  select * into orig from app.invoice where id = p_invoice and deleted_at is null;
  if orig.id is null then raise exception 'INVOICE_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if orig.doc_kind <> 'invoice' then
    raise exception 'NOT_AN_INVOICE: only invoices can be debited' using errcode = 'raise_exception';
  end if;
  if p_amount_excl is null or p_amount_excl <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'raise_exception';
  end if;

  v_rate := coalesce(p_vat_rate,
                     (select vat_rate from app.invoice_line where invoice_id = orig.id order by created_at limit 1),
                     0);
  v_vat  := round(p_amount_excl * v_rate);
  v_incl := p_amount_excl + v_vat;

  insert into app.invoice (
    org_id, property_id, contract_id, charge_id, owner_id, buyer_party_id,
    doc_kind, ref_invoice_id, reason, invoice_type, issue_at, supply_date,
    supplier_name, supplier_vat_number, supplier_cr_number, buyer_name, buyer_vat_number, buyer_id,
    total_excl_vat_halalas, total_vat_halalas, total_incl_vat_halalas, created_by
  ) values (
    orig.org_id, orig.property_id, orig.contract_id, null, orig.owner_id, orig.buyer_party_id,
    'debit_note', orig.id, p_reason, orig.invoice_type, now(), orig.supply_date,
    orig.supplier_name, orig.supplier_vat_number, orig.supplier_cr_number, orig.buyer_name, orig.buyer_vat_number, orig.buyer_id,
    p_amount_excl, v_vat, v_incl, auth.uid()
  ) returning id into v_note;

  insert into app.invoice_line (
    org_id, invoice_id, charge_id, description, quantity,
    unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas, line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason
  ) values (
    orig.org_id, v_note, null, coalesce(nullif(btrim(p_desc), ''), 'مبلغ إضافي'), 1,
    p_amount_excl, v_rate, v_vat, p_amount_excl, v_incl, null
  );

  perform app.write_audit(orig.org_id, 'invoice.debit_note', 'invoice', v_note,
                          jsonb_build_object('ref', orig.id, 'reason', p_reason, 'amount', p_amount_excl));
  return v_note;
end;
$$;

revoke all on function app.issue_credit_note(uuid, text) from public;
revoke all on function app.issue_debit_note(uuid, text, text, bigint, numeric) from public;
grant execute on function app.issue_credit_note(uuid, text) to authenticated, service_role;
grant execute on function app.issue_debit_note(uuid, text, text, bigint, numeric) to authenticated, service_role;

-- ================================================================
-- 0025_owner_remittance.sql
-- ================================================================
-- 0025_owner_remittance.sql
-- توريد المالك (owner remittance): a record of a payout the office made to an owner — the owner-side
-- counterpart of the tenant receipt. The office collects rent, keeps its management fee, and remits
-- the net to the owner; each payout is a numbered voucher (proof of remittance) tied optionally to a
-- period. The "how much is owed" side is already computed by app.owner_statement (0020); this table
-- records "how much was actually paid out", so: net(period) − remitted(period) = still owed.
--
-- Numbering reuses the per-org counter (0022): kind = 'remittance:<year>' → RM-YYYY-NNNNN, gapless
-- per (org, year). Org-scoped RLS (an owner is org-scoped). Plain inserts from the app layer.

create table if not exists app.owner_remittance (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  owner_id       uuid not null references app.owner(id),
  remittance_seq bigint,
  remittance_no  text,
  amount_halalas bigint not null check (amount_halalas > 0),
  method         app.payment_method not null default 'bank_transfer',
  remitted_at    timestamptz not null default now(),
  period_from    date,
  period_to      date,
  reference      text,
  notes          text,
  created_by     uuid references app.identity(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text
);

create index if not exists owner_remittance_owner_idx on app.owner_remittance (owner_id) where deleted_at is null;
create index if not exists owner_remittance_org_idx   on app.owner_remittance (org_id) where deleted_at is null;
create unique index if not exists owner_remittance_no_uniq
  on app.owner_remittance (org_id, remittance_no) where remittance_no is not null;

-- Numbering trigger (mirrors receipt/invoice; per org+year, gapless).
create or replace function app.tg_assign_remittance_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year text;
begin
  if new.remittance_seq is null then
    v_year := to_char((coalesce(new.remitted_at, now())) at time zone 'Asia/Riyadh', 'YYYY');
    new.remittance_seq := app.next_counter(new.org_id, 'remittance:' || v_year);
    new.remittance_no  := 'RM-' || v_year || '-' || lpad(new.remittance_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists owner_remittance_assign_no on app.owner_remittance;
create trigger owner_remittance_assign_no
  before insert on app.owner_remittance
  for each row execute function app.tg_assign_remittance_no();

drop trigger if exists owner_remittance_set_updated_at on app.owner_remittance;
create trigger owner_remittance_set_updated_at before update on app.owner_remittance
  for each row execute function app.set_updated_at();

grant select, insert, update on app.owner_remittance to authenticated, service_role;

alter table app.owner_remittance enable row level security;

drop policy if exists owner_remittance_all on app.owner_remittance;
create policy owner_remittance_all on app.owner_remittance for all
  using (app.has_org_access(org_id))
  with check (app.has_org_access(org_id));

-- ================================================================
-- 0026_member_invitations.sql
-- ================================================================
-- 0026_member_invitations.sql
-- Team management helpers on top of the existing membership/invitation model:
--   * org_members()      — an admin-only roster of the active org's members WITH their phone.
--     Identity is self-only under RLS (a member cannot read another member's identity row), so this
--     SECURITY DEFINER function is the single sanctioned way for an admin to see who's on the team.
--   * create_invitation() — an admin mints an invitation; the RAW token is returned ONCE to share as
--     a join link, and only its sha256 hash is stored. accept_invitation() (0013) consumes the token
--     and creates the membership. Revoking/role/status changes stay plain admin-gated table updates.

create or replace function app.org_members()
returns table (
  membership_id uuid,
  identity_id   uuid,
  phone_e164    text,
  role          app.membership_role,
  status        app.membership_status,
  scope_all     boolean,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid := app.current_org_id();
begin
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN: admins only' using errcode = 'raise_exception';
  end if;
  return query
    select m.id, m.identity_id, i.phone_e164, m.role, m.status, m.scope_all, m.created_at
    from app.membership m
    join app.identity i on i.id = m.identity_id
    where m.org_id = v_org and m.deleted_at is null
    order by (m.role = 'owner') desc, m.created_at;
end;
$$;

create or replace function app.create_invitation(
  p_phone       text,
  p_email       text,
  p_role        app.membership_role,
  p_scope_all   boolean,
  p_expires_days int default 14
)
returns text  -- the raw token, shown once to build the join link
language plpgsql
security invoker
set search_path = app, extensions, pg_temp
as $$
declare
  v_org   uuid := app.current_org_id();
  v_token text;
  v_id    uuid;
begin
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN: admins only' using errcode = 'raise_exception';
  end if;
  if coalesce(nullif(btrim(p_phone), ''), nullif(btrim(p_email), '')) is null then
    raise exception 'CONTACT_REQUIRED: phone or email' using errcode = 'raise_exception';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into app.invitation (org_id, phone_e164, email, role, scope_all, token_hash, expires_at, created_by)
  values (
    v_org,
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_email), ''),
    coalesce(p_role, 'staff'),
    coalesce(p_scope_all, true),
    encode(digest(v_token, 'sha256'), 'hex'),
    now() + (coalesce(p_expires_days, 14) || ' days')::interval,
    auth.uid()
  )
  returning id into v_id;

  perform app.write_audit(v_org, 'invitation.create', 'invitation', v_id,
                          jsonb_build_object('role', coalesce(p_role, 'staff')));
  return v_token;
end;
$$;

revoke all on function app.org_members() from public;
revoke all on function app.create_invitation(text, text, app.membership_role, boolean, int) from public;
grant execute on function app.org_members() to authenticated, service_role;
grant execute on function app.create_invitation(text, text, app.membership_role, boolean, int) to authenticated, service_role;

-- ================================================================
-- 0027_contract_amendments.sql
-- ================================================================
-- 0027_contract_amendments.sql
-- The sanctioned way to change an ACTIVE contract (which is immutable — see tg_contract_immutable):
-- record a versioned app.contract_amendment and apply the effect on the mutable side (charges,
-- lifecycle status), never by editing the frozen legal fields.
--
--   * amend_contract_rent      — from an effective date, re-price the FUTURE, still-untouched charges
--     at a new annual rent. The contract's annual_rent_halalas stays the original legal figure; the
--     amendment payload records from→to; only charges with no payments yet are re-priced (a
--     part-paid charge is left as-is to avoid orphaning allocations).
--   * amend_contract_terminate — end an active contract early: status→terminated (+reason/timestamp,
--     all lifecycle-allowed), cancel future untouched dues, and free the unit. end_date (frozen)
--     is untouched; the amendment records the effective early-end date.
--
-- Both are SECURITY INVOKER (RLS + property scope apply) and atomic.

-- Frequency → (#periods per year, month step). Mirrors activate_contract (0019).
create or replace function app.contract_period_shape(p_freq app.payment_frequency)
returns table (periods int, step int)
language sql immutable as $$
  select case p_freq
           when 'monthly' then 12 when 'quarterly' then 4
           when 'semi_annual' then 2 when 'annual' then 1 else 1 end,
         case p_freq
           when 'monthly' then 1 when 'quarterly' then 3
           when 'semi_annual' then 6 when 'annual' then 12 else 0 end;
$$;

create or replace function app.amend_contract_rent(
  p_contract uuid, p_new_annual bigint, p_effective date, p_reason text
) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  c         app.contract;
  v_periods int;
  v_base    bigint;
  v_rem     bigint;
  v_rate    numeric(5,4);
  v_type    app.charge_type;
  v_last    date;
  v_amend   uuid;
  v_ver     int;
  r         record;
begin
  select * into c from app.contract where id = p_contract and deleted_at is null;
  if c.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if c.status <> 'active' then raise exception 'CONTRACT_NOT_ACTIVE: only active contracts can be amended' using errcode = 'raise_exception'; end if;
  if p_new_annual is null or p_new_annual < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'raise_exception'; end if;

  select periods into v_periods from app.contract_period_shape(c.payment_frequency);
  v_base := p_new_annual / v_periods;
  v_rem  := p_new_annual - v_base * v_periods;
  if c.contract_kind = 'commercial' then v_rate := 0.15; v_type := 'commercial_rent';
  else v_rate := 0; v_type := 'residential_rent'; end if;

  -- The true last due date of the whole schedule (so the rounding remainder lands on it).
  select max(due_date) into v_last from app.charge where contract_id = c.id and deleted_at is null;

  v_ver := (select coalesce(max(version), 0) + 1 from app.contract_amendment where contract_id = c.id);
  insert into app.contract_amendment (org_id, contract_id, version, change_type, payload, effective_date, reason, created_by)
  values (c.org_id, c.id, v_ver, 'rent_change',
          jsonb_build_object('annual_rent_halalas', jsonb_build_object('from', c.annual_rent_halalas, 'to', p_new_annual)),
          p_effective, p_reason, auth.uid())
  returning id into v_amend;

  -- Re-price each future, still-untouched charge (no allocations) at the new per-period amount.
  for r in
    select ch.id, ch.due_date
    from app.charge ch
    where ch.contract_id = c.id and ch.deleted_at is null and ch.due_date >= p_effective
      and not exists (select 1 from app.payment_allocation a where a.charge_id = ch.id)
  loop
    update app.charge set deleted_at = now(), deleted_reason = 'rent_amendment' where id = r.id;
    insert into app.charge (org_id, property_id, unit_id, contract_id, charge_type, due_date,
      amount_excl_vat_halalas, vat_rate, vat_amount_halalas, description)
    values (c.org_id, c.property_id, c.unit_id, c.id, v_type, r.due_date,
      v_base + case when r.due_date = v_last then v_rem else 0 end,
      v_rate,
      round((v_base + case when r.due_date = v_last then v_rem else 0 end) * v_rate),
      'إيجار — بعد تعديل الإيجار');
  end loop;

  perform app.write_audit(c.org_id, 'contract.amend_rent', 'contract', c.id,
                          jsonb_build_object('amendment', v_amend, 'new_annual', p_new_annual));
  return v_amend;
end;
$$;

create or replace function app.amend_contract_terminate(
  p_contract uuid, p_effective date, p_reason text
) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  c       app.contract;
  v_amend uuid;
  v_ver   int;
begin
  select * into c from app.contract where id = p_contract and deleted_at is null;
  if c.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if c.status <> 'active' then raise exception 'CONTRACT_NOT_ACTIVE: only active contracts can be terminated' using errcode = 'raise_exception'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'raise_exception'; end if;

  v_ver := (select coalesce(max(version), 0) + 1 from app.contract_amendment where contract_id = c.id);
  insert into app.contract_amendment (org_id, contract_id, version, change_type, payload, effective_date, reason, created_by)
  values (c.org_id, c.id, v_ver, 'early_termination',
          jsonb_build_object('status', jsonb_build_object('from', 'active', 'to', 'terminated'),
                             'effective_date', p_effective),
          p_effective, p_reason, auth.uid())
  returning id into v_amend;

  update app.contract set status = 'terminated', terminated_at = now(), termination_reason = p_reason where id = c.id;

  -- Cancel future untouched dues (on/after the effective date, no payments against them).
  update app.charge ch set deleted_at = now(), deleted_reason = 'early_termination'
  where ch.contract_id = c.id and ch.deleted_at is null and ch.due_date >= p_effective
    and not exists (select 1 from app.payment_allocation a where a.charge_id = ch.id);

  -- Free the unit.
  update app.unit set current_status = 'vacant' where id = c.unit_id;

  perform app.write_audit(c.org_id, 'contract.terminate', 'contract', c.id,
                          jsonb_build_object('amendment', v_amend, 'effective', p_effective));
  return v_amend;
end;
$$;

revoke all on function app.amend_contract_rent(uuid, bigint, date, text) from public;
revoke all on function app.amend_contract_terminate(uuid, date, text) from public;
grant execute on function app.contract_period_shape(app.payment_frequency) to authenticated, service_role;
grant execute on function app.amend_contract_rent(uuid, bigint, date, text) to authenticated, service_role;
grant execute on function app.amend_contract_terminate(uuid, date, text) to authenticated, service_role;

-- ================================================================
-- 0028_owner_portal.sql
-- ================================================================
-- 0028_owner_portal.sql
-- Owner self-service portal. An owner is NOT an office member (no membership → the office RLS gives
-- them nothing). Instead their party is linked to a login identity, and they read ONLY their own data
-- through SECURITY DEFINER functions gated on party.identity_id = auth.uid(). The office RLS model is
-- left completely untouched.
--
-- Linking reuses the existing invitation table + the Party↔Identity link guard (app.allow_party_link):
--   * create_owner_invitation(owner) — an admin mints a portal invite for a specific owner's party.
--   * accept_owner_invitation(token) — the owner (after signing in) links their party to their login.
-- Reading:
--   * my_owner_links()             — the owner profiles linked to me (across offices).
--   * owner_portal_statement/…     — gate on ownership, then reuse the office-side aggregation (which,
--     invoked inside a definer function, runs above RLS for that one owner).

alter table app.invitation add column if not exists party_id uuid references app.party(id);
alter table app.invitation add column if not exists kind     text not null default 'membership';  -- membership | owner_portal

-- ---------------------------------------------------------------------------
-- Ownership gate: does this owner belong to the caller's login?
-- ---------------------------------------------------------------------------
create or replace function app.owner_is_mine(p_owner uuid)
returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.owner o join app.party p on p.id = o.party_id
    where o.id = p_owner and o.deleted_at is null and p.identity_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- create_owner_invitation(owner) → raw token (shown once). Admin-gated.
-- ---------------------------------------------------------------------------
create or replace function app.create_owner_invitation(p_owner uuid)
returns text
language plpgsql security invoker set search_path = app, extensions, pg_temp as $$
declare
  v_org   uuid := app.current_org_id();
  v_party uuid;
  v_phone text;
  v_email text;
  v_token text;
  v_id    uuid;
begin
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN: admins only' using errcode = 'raise_exception';
  end if;

  select o.party_id, p.phone_e164, p.email into v_party, v_phone, v_email
  from app.owner o join app.party p on p.id = o.party_id
  where o.id = p_owner and o.org_id = v_org and o.deleted_at is null and not o.is_self;
  if v_party is null then
    raise exception 'OWNER_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'OWNER_NO_CONTACT: add a phone or email to the owner first' using errcode = 'raise_exception';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app.invitation (org_id, party_id, kind, phone_e164, email, token_hash, expires_at, created_by)
  values (v_org, v_party, 'owner_portal', v_phone, v_email,
          encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days', auth.uid())
  returning id into v_id;

  perform app.write_audit(v_org, 'owner_portal.invite', 'party', v_party, jsonb_build_object('invitation', v_id));
  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_owner_invitation(token) → linked party id. Links the party to the caller's login.
-- SECURITY DEFINER: sets app.allow_party_link for its single UPDATE (mirrors link_party_identity).
-- ---------------------------------------------------------------------------
create or replace function app.accept_owner_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_me  uuid := auth.uid();
  v_inv app.invitation;
  v_cur uuid;
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception'; end if;

  select * into v_inv from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and kind = 'owner_portal' and accepted_at is null and revoked_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null and v_cur <> v_me then
    raise exception 'ALREADY_LINKED: this owner is already linked to another login' using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);
  update app.party set identity_id = v_me where id = v_inv.party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'owner_portal.link', 'party', v_inv.party_id, '{}'::jsonb);
  return v_inv.party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal reads. All SECURITY DEFINER, all gated on ownership by login identity.
-- ---------------------------------------------------------------------------
create or replace function app.my_owner_links()
returns table (owner_id uuid, org_id uuid, org_name text, display_name text, iban text, bank_name text)
language sql stable security definer set search_path = app, pg_temp as $$
  select o.id, o.org_id, org.name, p.display_name, o.iban, o.bank_name
  from app.owner o
  join app.party p on p.id = o.party_id
  join app.organization org on org.id = o.org_id
  where p.identity_id = auth.uid() and o.deleted_at is null and not o.is_self
  order by org.name;
$$;

create or replace function app.owner_portal_statement(p_owner uuid, p_from date, p_to date)
returns table (property_id uuid, property_name text, collected_halalas bigint,
               outstanding_halalas bigint, fee_halalas bigint, net_halalas bigint)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  -- owner_statement is SECURITY INVOKER; invoked here it runs above RLS (definer context) for this owner.
  return query select * from app.owner_statement(p_owner, p_from, p_to);
end;
$$;

create or replace function app.owner_portal_properties(p_owner uuid)
returns table (id uuid, name text, city text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select pr.id, pr.name, pr.city from app.property pr
    where pr.owner_id = p_owner and pr.deleted_at is null order by pr.name;
end;
$$;

create or replace function app.owner_portal_remittances(p_owner uuid)
returns table (id uuid, remittance_no text, amount_halalas bigint, method app.payment_method,
               remitted_at timestamptz, period_from date, period_to date, reference text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select r.id, r.remittance_no, r.amount_halalas, r.method, r.remitted_at, r.period_from, r.period_to, r.reference
    from app.owner_remittance r
    where r.owner_id = p_owner and r.deleted_at is null order by r.remitted_at desc;
end;
$$;

revoke all on function app.create_owner_invitation(uuid) from public;
revoke all on function app.accept_owner_invitation(text) from public;
grant execute on function app.owner_is_mine(uuid),
                         app.create_owner_invitation(uuid),
                         app.accept_owner_invitation(text),
                         app.my_owner_links(),
                         app.owner_portal_statement(uuid, date, date),
                         app.owner_portal_properties(uuid),
                         app.owner_portal_remittances(uuid)
  to authenticated, service_role;

-- ================================================================
-- 0029_tenant_portal.sql
-- ================================================================
-- 0029_tenant_portal.sql
-- Tenant self-service portal — the mirror of the owner portal (0028). A tenant is a party (not an
-- office member); their party is linked to a login and they read ONLY their own data through
-- SECURITY DEFINER functions gated on party.identity_id = auth.uid(). Office RLS is untouched.
--
-- Reuses invitation.party_id + kind ('tenant_portal') from 0028, and generalizes acceptance:
-- accept_portal_invitation handles both owner_portal and tenant_portal invites (both just link the
-- party). create_owner_invitation / accept_owner_invitation from 0028 stay valid.

create or replace function app.tenant_is_mine(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.tenant t join app.party p on p.id = t.party_id
    where t.id = p_tenant and t.deleted_at is null and p.identity_id = auth.uid()
  );
$$;

create or replace function app.create_tenant_invitation(p_tenant uuid)
returns text
language plpgsql security invoker set search_path = app, extensions, pg_temp as $$
declare
  v_org   uuid := app.current_org_id();
  v_party uuid;
  v_phone text;
  v_email text;
  v_token text;
  v_id    uuid;
begin
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN: admins only' using errcode = 'raise_exception';
  end if;

  select t.party_id, p.phone_e164, p.email into v_party, v_phone, v_email
  from app.tenant t join app.party p on p.id = t.party_id
  where t.id = p_tenant and t.org_id = v_org and t.deleted_at is null;
  if v_party is null then raise exception 'TENANT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if v_phone is null and v_email is null then
    raise exception 'TENANT_NO_CONTACT: add a phone or email to the tenant first' using errcode = 'raise_exception';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app.invitation (org_id, party_id, kind, phone_e164, email, token_hash, expires_at, created_by)
  values (v_org, v_party, 'tenant_portal', v_phone, v_email,
          encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days', auth.uid())
  returning id into v_id;

  perform app.write_audit(v_org, 'tenant_portal.invite', 'party', v_party, jsonb_build_object('invitation', v_id));
  return v_token;
end;
$$;

-- Generic portal-invite accept: links the invitation's party to the caller's login (owner or tenant).
create or replace function app.accept_portal_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_me  uuid := auth.uid();
  v_inv app.invitation;
  v_cur uuid;
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception'; end if;

  select * into v_inv from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null and revoked_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null and v_cur <> v_me then
    raise exception 'ALREADY_LINKED: this profile is already linked to another login' using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);
  update app.party set identity_id = v_me where id = v_inv.party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'portal.link', 'party', v_inv.party_id,
                          jsonb_build_object('kind', v_inv.kind));
  return v_inv.party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal reads (SECURITY DEFINER, gated on tenant ownership by login identity).
-- ---------------------------------------------------------------------------
create or replace function app.my_tenant_links()
returns table (tenant_id uuid, org_id uuid, org_name text, display_name text)
language sql stable security definer set search_path = app, pg_temp as $$
  select t.id, t.org_id, org.name, p.display_name
  from app.tenant t
  join app.party p on p.id = t.party_id
  join app.organization org on org.id = t.org_id
  where p.identity_id = auth.uid() and t.deleted_at is null
  order by org.name;
$$;

create or replace function app.tenant_portal_contracts(p_tenant uuid)
returns table (id uuid, contract_number text, status app.contract_status, start_date date, end_date date,
               annual_rent_halalas bigint, payment_frequency app.payment_frequency,
               unit_number text, property_name text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select c.id, c.contract_number, c.status, c.start_date, c.end_date, c.annual_rent_halalas,
           c.payment_frequency, u.unit_number, pr.name
    from app.contract c join app.unit u on u.id = c.unit_id join app.property pr on pr.id = c.property_id
    where c.tenant_id = p_tenant and c.deleted_at is null order by c.start_date desc;
end;
$$;

create or replace function app.tenant_portal_charges(p_tenant uuid)
returns table (charge_id uuid, contract_id uuid, due_date date, gross_halalas bigint,
               allocated_halalas bigint, balance_halalas bigint, is_settled boolean, is_overdue boolean)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select cb.charge_id, cb.contract_id, cb.due_date, cb.gross_halalas::bigint,
           cb.allocated_halalas::bigint, cb.balance_halalas::bigint, cb.is_settled, cb.is_overdue
    from app.charge_balance cb
    where cb.contract_id in (select c.id from app.contract c where c.tenant_id = p_tenant and c.deleted_at is null)
    order by cb.due_date;
end;
$$;

create or replace function app.tenant_portal_payments(p_tenant uuid)
returns table (id uuid, receipt_no text, amount_halalas bigint, method app.payment_method, received_at timestamptz)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select pay.id, pay.receipt_no, pay.amount_halalas, pay.method, pay.received_at
    from app.payment pay
    where pay.party_id = (select tt.party_id from app.tenant tt where tt.id = p_tenant) and pay.deleted_at is null
    order by pay.received_at desc;
end;
$$;

revoke all on function app.create_tenant_invitation(uuid) from public;
revoke all on function app.accept_portal_invitation(text) from public;
grant execute on function app.tenant_is_mine(uuid),
                         app.create_tenant_invitation(uuid),
                         app.accept_portal_invitation(text),
                         app.my_tenant_links(),
                         app.tenant_portal_contracts(uuid),
                         app.tenant_portal_charges(uuid),
                         app.tenant_portal_payments(uuid)
  to authenticated, service_role;

-- ================================================================
-- 0030_portal_documents.sql
-- ================================================================
-- 0030_portal_documents.sql
-- Data for self-service PRINTABLE documents in the portals. The owner statement + remittance voucher
-- already have everything they need from the 0028 portal functions, so they need no new data here;
-- this migration adds only what the tenant RECEIPT needs (payment detail + its allocation lines) and
-- the org header (name/CR/VAT) for the owner's printable statement/voucher. All SECURITY DEFINER,
-- all gated on ownership by login identity (same pattern as 0028/0029).

-- Full receipt header for one of the tenant's own payments.
create or replace function app.tenant_portal_receipt(p_tenant uuid, p_payment uuid)
returns table (receipt_no text, amount_halalas bigint, method app.payment_method, received_at timestamptz,
               reference text, notes text, payer_name text, payer_id text,
               org_name text, org_cr text, org_vat text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select pay.receipt_no, pay.amount_halalas, pay.method, pay.received_at, pay.reference, pay.notes,
           pp.display_name, coalesce(pp.national_id, pp.iqama_id, pp.cr_number),
           org.name, org.cr_number, org.vat_number
    from app.payment pay
    join app.tenant t on t.id = p_tenant
    join app.party pp on pp.id = t.party_id
    join app.organization org on org.id = pay.org_id
    where pay.id = p_payment and pay.party_id = t.party_id and pay.deleted_at is null;
end;
$$;

-- What that payment settled (its allocations).
create or replace function app.tenant_portal_receipt_lines(p_tenant uuid, p_payment uuid)
returns table (description text, amount_halalas bigint, contract_number text, unit_number text, property_name text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.tenant_is_mine(p_tenant) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select ch.description, a.amount_halalas, c.contract_number, u.unit_number, pr.name
    from app.payment_allocation a
    join app.payment pay on pay.id = a.payment_id
    join app.tenant t on t.id = p_tenant
    join app.charge ch on ch.id = a.charge_id
    left join app.contract c on c.id = ch.contract_id
    left join app.unit u on u.id = ch.unit_id
    left join app.property pr on pr.id = ch.property_id
    where a.payment_id = p_payment and pay.party_id = t.party_id and pay.deleted_at is null;
end;
$$;

-- Office identity for the owner's printable statement/voucher header.
create or replace function app.owner_portal_org(p_owner uuid)
returns table (org_name text, org_cr text, org_vat text)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.owner_is_mine(p_owner) then raise exception 'FORBIDDEN' using errcode = 'raise_exception'; end if;
  return query
    select org.name, org.cr_number, org.vat_number
    from app.owner o join app.organization org on org.id = o.org_id where o.id = p_owner;
end;
$$;

grant execute on function app.tenant_portal_receipt(uuid, uuid),
                         app.tenant_portal_receipt_lines(uuid, uuid),
                         app.owner_portal_org(uuid)
  to authenticated, service_role;

-- ================================================================
-- 0031_contract_renewal.sql
-- ================================================================
-- 0031_contract_renewal.sql
-- Contract renewal (تجديد العقد) done the immutability-safe way: a renewal is a NEW successor
-- contract, never an edit of the frozen predecessor. end_date is a legal field frozen after
-- activation (tg_contract_immutable), so "extending" a contract is modelled as a follow-on:
--
--   * renew_contract   — create a DRAFT successor copied from the source (same unit/tenant/property,
--     kind, frequency, deposit, fees), with new start/end/rent and a back-link renewed_from_contract_id.
--     The source is untouched; the office reviews the draft then activates it.
--   * activate_renewal — atomically retire the predecessor and start the successor: if the source is
--     still 'active', cancel its future still-untouched dues (>= the successor start, to avoid an
--     overlap double-charge) and move it 'active' → 'expired', THEN reuse activate_contract to build
--     the successor's schedule and mark the unit rented. Order matters: the source leaves 'active'
--     before the successor enters it, so the one-active-per-unit partial index is always satisfied.
--
-- Both are SECURITY INVOKER (RLS + property scope apply) and atomic.

-- Back-link a successor to its predecessor. Nullable; only set at draft-insert time, never updated
-- (so the immutability guard, which does not list it, is irrelevant here).
alter table app.contract
  add column if not exists renewed_from_contract_id uuid references app.contract(id);

create index if not exists contract_renewed_from_idx
  on app.contract (renewed_from_contract_id) where renewed_from_contract_id is not null;

-- ---------------------------------------------------------------------------
-- renew_contract(source, start, end, new_annual, number) -> new draft contract id
-- Renews an active or already-expired contract. Blocks a second live renewal off the same source.
-- ---------------------------------------------------------------------------
create or replace function app.renew_contract(
  p_source     uuid,
  p_start      date,
  p_end        date,
  p_new_annual bigint,
  p_number     text default null
) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  s        app.contract;
  v_number text;
  v_new    uuid;
begin
  select * into s from app.contract where id = p_source and deleted_at is null;
  if s.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if s.status not in ('active', 'expired') then
    raise exception 'CONTRACT_NOT_RENEWABLE: only active or expired contracts can be renewed'
      using errcode = 'raise_exception';
  end if;

  -- One live successor per source (a cancelled/deleted draft does not count).
  if exists (
    select 1 from app.contract r
    where r.renewed_from_contract_id = s.id and r.status <> 'cancelled' and r.deleted_at is null
  ) then
    raise exception 'ALREADY_RENEWED: this contract already has a renewal' using errcode = 'raise_exception';
  end if;

  if p_start is null or p_end is null then raise exception 'DATES_REQUIRED' using errcode = 'raise_exception'; end if;
  if p_end < p_start then raise exception 'END_BEFORE_START' using errcode = 'raise_exception'; end if;
  if p_new_annual is null or p_new_annual < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception'; end if;

  v_number := coalesce(nullif(btrim(p_number), ''), s.contract_number || '-R' || extract(year from p_start)::int);

  insert into app.contract (
    org_id, property_id, unit_id, tenant_id, contract_number, deed_number, contract_kind,
    status, start_date, end_date, annual_rent_halalas, payment_frequency,
    deposit_halalas, service_fees_halalas, terms, renewed_from_contract_id, created_by
  ) values (
    s.org_id, s.property_id, s.unit_id, s.tenant_id, v_number, s.deed_number, s.contract_kind,
    'draft', p_start, p_end, p_new_annual, s.payment_frequency,
    s.deposit_halalas, s.service_fees_halalas, s.terms, s.id, auth.uid()
  )
  returning id into v_new;

  perform app.write_audit(s.org_id, 'contract.renew', 'contract', s.id,
                          jsonb_build_object('successor', v_new, 'start', p_start, 'end', p_end,
                                             'annual_rent_halalas', p_new_annual));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- activate_renewal(new) — retire the predecessor, then activate the successor. Atomic.
-- ---------------------------------------------------------------------------
create or replace function app.activate_renewal(p_new uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  n app.contract;
  s app.contract;
begin
  select * into n from app.contract where id = p_new and deleted_at is null;
  if n.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if n.renewed_from_contract_id is null then
    raise exception 'NOT_A_RENEWAL: this contract is not a renewal' using errcode = 'raise_exception';
  end if;
  if n.status <> 'draft' then
    raise exception 'CONTRACT_NOT_DRAFT: only a draft renewal can be activated' using errcode = 'raise_exception';
  end if;

  select * into s from app.contract where id = n.renewed_from_contract_id and deleted_at is null;
  if s.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;

  if s.status = 'active' then
    -- Cancel the source's future, still-untouched dues that would overlap the successor.
    update app.charge ch set deleted_at = now(), deleted_reason = 'superseded_by_renewal'
    where ch.contract_id = s.id and ch.deleted_at is null and ch.due_date >= n.start_date
      and not exists (select 1 from app.payment_allocation a where a.charge_id = ch.id);

    update app.contract set status = 'expired' where id = s.id;
  elsif s.status <> 'expired' then
    -- Source was terminated/cancelled after the draft was prepared — refuse rather than guess.
    raise exception 'SOURCE_NOT_RENEWABLE: the predecessor is no longer active or expired'
      using errcode = 'raise_exception';
  end if;

  -- Reuse the canonical activation (schedule generation + unit → rented). The source has already
  -- left 'active', so the one-active-per-unit index accepts the successor.
  perform app.activate_contract(p_new);

  perform app.write_audit(n.org_id, 'contract.renew_activate', 'contract', n.id,
                          jsonb_build_object('predecessor', s.id));
end;
$$;

revoke all on function app.renew_contract(uuid, date, date, bigint, text) from public;
revoke all on function app.activate_renewal(uuid) from public;
grant execute on function app.renew_contract(uuid, date, date, bigint, text) to authenticated, service_role;
grant execute on function app.activate_renewal(uuid) to authenticated, service_role;

-- ================================================================
-- 0032_drop_legacy_otp.sql
-- ================================================================
-- 0032_drop_legacy_otp.sql
-- Sprint B / هـ-35, مر-19: remove the superseded custom phone-OTP + custom-session subsystem.
-- Since 0017 the live app authenticates via Supabase Auth (GoTrue) phone OTP; the objects below
-- (defined in 0004/0014) are dead — zero references in app/lib, and 0017's auth path does not use
-- them. `app.identity` is CORE and is KEPT. Idempotent (IF EXISTS); safe on live + fresh DB.

-- Functions first — they reference the auth-layer tables.
drop function if exists app.request_otp(text, inet, text, text);
drop function if exists app.verify_otp(text, text, inet, text, text);
drop function if exists app.otp_rate_ok(text, inet, text);
drop function if exists app.gen_otp_code();
drop function if exists app.otp_pepper();

-- Tables — CASCADE also drops their RLS policies, indexes, updated_at triggers, grants, and FKs.
-- None of the five is referenced by a surviving object. `identity` (the FK parent) is untouched.
drop table if exists app.otp_challenge cascade;
drop table if exists app.auth_attempt  cascade;
drop table if exists app.sms_outbox    cascade;
drop table if exists app.session       cascade;
drop table if exists app.auth_method   cascade;

-- The enum was used only by app.auth_method.method — now orphaned.
drop type if exists app.auth_method_type;

-- ================================================================
-- 0033_viewer_readonly.sql
-- ================================================================
-- 0033_viewer_readonly.sql
-- Sprint B / هـ-16, مر-14: enforce that the `viewer` role is TRULY read-only, at the database.
-- Until now the middle roles (manager/accountant/staff/viewer) all wrote like any active member;
-- a 'viewer' could INSERT/UPDATE/DELETE. We close only the viewer gap here (the fuller per-role
-- permission matrix is a separate product decision, deferred).
--
-- Mechanism: RESTRICTIVE policies AND-combine with the existing permissive policies. We add
-- restrictive INSERT/UPDATE (+ DELETE where granted) policies gated on app.is_org_writer(), leaving
-- SELECT untouched (viewers still read). SECURITY DEFINER RPCs (org creation, invitation accept,
-- portal reads, counters, audit) run above RLS and are unaffected; SECURITY INVOKER writes
-- (activate_contract, record_charge_payment, amend/renew, issue_invoice…) are correctly blocked for
-- a viewer. Idempotent (drop policy if exists). §6.

-- The write gate: active membership in the active org whose role is not 'viewer'.
create or replace function app.is_org_writer(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.has_org_access(p_org)
     and exists (
       select 1 from app.membership m
       where m.identity_id = auth.uid()
         and m.org_id      = p_org
         and m.status      = 'active'
         and m.deleted_at is null
         and m.role <> 'viewer'
     );
$$;
revoke all on function app.is_org_writer(uuid) from public;
grant execute on function app.is_org_writer(uuid) to authenticated, service_role;

-- Member-writable tables that carry org_id directly → restrictive INSERT + UPDATE for non-viewers.
do $$
declare t text;
begin
  foreach t in array array[
    'party','owner','tenant',
    'property','building','unit','unit_status_history',
    'contract','contract_amendment','management_agreement',
    'charge','payment','payment_allocation',
    'document','import_batch','import_row',
    'invoice','invoice_line','owner_remittance'
  ] loop
    execute format('drop policy if exists %I on app.%I', t || '_writer_ins', t);
    execute format(
      'create policy %I on app.%I as restrictive for insert with check (app.is_org_writer(org_id))',
      t || '_writer_ins', t);
    execute format('drop policy if exists %I on app.%I', t || '_writer_upd', t);
    execute format(
      'create policy %I on app.%I as restrictive for update using (app.is_org_writer(org_id)) with check (app.is_org_writer(org_id))',
      t || '_writer_upd', t);
  end loop;
end $$;

-- payment_allocation grants DELETE to authenticated → gate it too.
drop policy if exists payment_allocation_writer_del on app.payment_allocation;
create policy payment_allocation_writer_del on app.payment_allocation
  as restrictive for delete using (app.is_org_writer(org_id));

-- management_agreement_unit has no org_id → resolve org via its parent agreement (INSERT/UPDATE/DELETE).
drop policy if exists mgmt_unit_writer_ins on app.management_agreement_unit;
create policy mgmt_unit_writer_ins on app.management_agreement_unit
  as restrictive for insert
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)));
drop policy if exists mgmt_unit_writer_upd on app.management_agreement_unit;
create policy mgmt_unit_writer_upd on app.management_agreement_unit
  as restrictive for update
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)))
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)));
drop policy if exists mgmt_unit_writer_del on app.management_agreement_unit;
create policy mgmt_unit_writer_del on app.management_agreement_unit
  as restrictive for delete
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)));

-- ================================================================
-- 0034_notifications.sql
-- ================================================================
-- 0034_notifications.sql
-- Sprint C / C-2: in-app operational notifications for the office (dues due-soon/overdue, contracts
-- expiring). DELIVERY CHANNELS (SMS/email) are intentionally NOT here — this is generation + storage
-- + in-app surfacing only; a channel plugs in later. All writes go through the SECURITY DEFINER
-- functions below, so there is no direct-write RLS surface (and no viewer-write concern).

create table if not exists app.notification (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references app.organization(id) on delete cascade,
  property_id  uuid references app.property(id) on delete cascade,  -- for scope filtering; NULL = org-level
  kind         text not null,          -- charge_due_soon | charge_overdue | contract_expiring
  entity_type  text,                   -- charge | contract
  entity_id    uuid,
  title        text not null,
  body         text,
  due_date     date,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists notification_org_unread_idx
  on app.notification (org_id, created_at desc) where read_at is null;
-- One notification per logical event → generation is idempotent (on conflict do nothing).
create unique index if not exists notification_dedupe on app.notification
  (org_id, kind,
   coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(due_date, '0001-01-01'::date));

alter table app.notification enable row level security;
grant select on app.notification to authenticated;
-- Reads respect property scope (NULL property = org-level, visible to any member). No write grant:
-- inserts/updates happen only via the DEFINER functions below.
create policy notification_select on app.notification for select
  using (app.has_property_access(org_id, property_id));

-- generate_notifications(org) — idempotent scan; returns the org's unread count.
create or replace function app.generate_notifications(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  -- Charges due within 7 days, not yet settled.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_due_soon', 'charge', c.id,
         'استحقاق قريب', 'دفعة تستحق بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and not cb.is_settled
    and c.due_date >= current_date and c.due_date <= current_date + 7
  on conflict do nothing;

  -- Overdue unsettled charges.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_overdue', 'charge', c.id,
         'دفعة متأخرة', 'دفعة متأخرة استحقّت بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and cb.is_overdue and not cb.is_settled
  on conflict do nothing;

  -- Active contracts ending within 30 days with no successor renewal yet.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select ct.org_id, ct.property_id, 'contract_expiring', 'contract', ct.id,
         'عقد ينتهي قريباً', 'العقد ' || ct.contract_number || ' ينتهي بتاريخ ' || ct.end_date, ct.end_date
  from app.contract ct
  where ct.org_id = p_org and ct.status = 'active' and ct.deleted_at is null
    and ct.end_date >= current_date and ct.end_date <= current_date + 30
    and not exists (
      select 1 from app.contract r
      where r.renewed_from_contract_id = ct.id and r.deleted_at is null and r.status <> 'cancelled')
  on conflict do nothing;

  return (select count(*)::int from app.notification where org_id = p_org and read_at is null);
end;
$$;

-- mark_notifications_read(org, ids) — any active member may clear their org's notifications
-- (NULL ids = clear all). A personal UI action; routed through a DEFINER fn (no table write grant).
create or replace function app.mark_notifications_read(p_org uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.notification set read_at = now()
  where org_id = p_org and read_at is null and (p_ids is null or id = any(p_ids));
end;
$$;

revoke all on function app.generate_notifications(uuid) from public;
revoke all on function app.mark_notifications_read(uuid, uuid[]) from public;
grant execute on function app.generate_notifications(uuid) to authenticated, service_role;
grant execute on function app.mark_notifications_read(uuid, uuid[]) to authenticated, service_role;

-- ================================================================
-- 0035_search_indexes.sql
-- ================================================================
-- 0035_search_indexes.sql
-- Sprint C / C-1: keep substring search (ilike '%q%') on the list pages fast as records grow, via
-- trigram GIN indexes on the searched text columns. Idempotent; safe on live + fresh DB.
create extension if not exists pg_trgm with schema extensions;

create index if not exists property_name_trgm    on app.property using gin (name            extensions.gin_trgm_ops);
create index if not exists party_display_trgm     on app.party    using gin (display_name    extensions.gin_trgm_ops);
create index if not exists contract_number_trgm   on app.contract using gin (contract_number extensions.gin_trgm_ops);
create index if not exists invoice_no_trgm        on app.invoice  using gin (invoice_no      extensions.gin_trgm_ops);
create index if not exists payment_receipt_trgm   on app.payment  using gin (receipt_no      extensions.gin_trgm_ops);

-- ================================================================
-- 0036_subscription.sql
-- ================================================================
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

-- ================================================================
-- 0037_identity_email.sql
-- ================================================================
-- 0037_identity_email.sql
-- Sprint E: allow EMAIL-first accounts. Until now app.identity required a KSA mobile, and the
-- auth→profile trigger only provisioned an identity when a valid phone was present — so an
-- email-only Supabase Auth user got NO identity row and could not create an org (FK on membership).
--
-- This migration makes phone OPTIONAL (email OR phone as the global key) and teaches the profile
-- trigger to provision email users. It is deliberately future-proof: nothing here assumes email
-- confirmation is off — turning it ON later is a Supabase dashboard toggle, not a code change (the
-- trigger fires on the auth.users insert regardless of confirmation state). Idempotent.

-- Phone is no longer mandatory. NOTE: the existing format CHECK (phone_e164 ~ '^\+9665…') already
-- passes for NULL (a CHECK is satisfied when it evaluates to NULL), so it keeps validating a phone
-- only when one is present — no need to touch it.
alter table app.identity alter column phone_e164 drop not null;

-- Contact floor: every identity must be reachable by at least one global key (phone OR email).
-- Existing rows all have a phone (it was NOT NULL until now), so the constraint holds on backfill.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'identity_contact_present') then
    alter table app.identity
      add constraint identity_contact_present check (phone_e164 is not null or email is not null);
  end if;
end $$;

comment on table app.identity is
  'Global person. id = auth.uid(). Reachable by phone_e164 OR email (at least one); both unique.';

-- Profile creator, now email-aware. Provisions an identity when we have EITHER a valid KSA mobile
-- OR an email, carrying full_name through from signup metadata when supplied. Single provisioning
-- point (unchanged contract) so enabling email confirmation / password reset later needs no change.
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text;
begin
  v_phone := app.normalize_phone_e164(new.phone);
  if v_phone is not null or new.email is not null then
    insert into app.identity (id, phone_e164, phone_raw, email, full_name)
    values (
      new.id, v_phone, new.phone, new.email,
      nullif(new.raw_user_meta_data ->> 'full_name', '')
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- ================================================================
-- 0038_notification_delivery.sql
-- ================================================================
-- 0038_notification_delivery.sql
-- Sprint F: multi-channel notification DELIVERY (email first, per ADR-0002). This is ADDITIVE over
-- 0034's `notification` table — that content is channel-agnostic — adding an append-only outbox plus
-- the functions to ENQUEUE (one email per active org member who has an email) and to DRAIN (claim →
-- send → mark) with full idempotency and a bounded 3-attempt backoff (1 → 5 → 30 min).
--
-- Trust boundary: enqueue runs with the user's session (has_org_access-gated). claim/mark are the
-- ONLY functions the Vercel-Cron drainer calls, and are granted to service_role ONLY. SMS is a future
-- channel value, not built here.

do $$ begin
  if not exists (select 1 from pg_type where typname='notification_channel' and typnamespace='app'::regnamespace) then
    create type app.notification_channel as enum ('in_app','email','sms');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname='delivery_status' and typnamespace='app'::regnamespace) then
    create type app.delivery_status as enum ('pending','sent','failed');
  end if;
end $$;

-- The outbox. org_id is denormalized from the notification for a simple RLS predicate and cheap
-- per-org queries. One row per (notification, channel, recipient) — the uniqueness that makes
-- enqueue idempotent and prevents a double-send.
create table if not exists app.notification_delivery (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references app.organization(id) on delete cascade,
  notification_id      uuid not null references app.notification(id)  on delete cascade,
  channel              app.notification_channel not null,
  target               text not null,                       -- resolved recipient (email address for now)
  status               app.delivery_status not null default 'pending',
  attempts             int  not null default 0,
  max_attempts         int  not null default 3,
  next_attempt_at      timestamptz not null default now(),  -- eligibility gate (backoff/lease)
  provider             text,                                -- 'resend'
  provider_message_id  text,
  provider_response    jsonb,
  last_error           text,
  last_attempt_at      timestamptz,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);

create unique index if not exists notification_delivery_unique
  on app.notification_delivery (notification_id, channel, target);
create index if not exists notification_delivery_due
  on app.notification_delivery (channel, next_attempt_at) where status = 'pending';

alter table app.notification_delivery enable row level security;
grant select on app.notification_delivery to authenticated;
-- Read-only to members of the owning org; every write goes through the DEFINER functions below.
drop policy if exists notification_delivery_select on app.notification_delivery;
create policy notification_delivery_select on app.notification_delivery for select
  using (app.has_org_access(org_id));

-- ---------------------------------------------------------------------------
-- enqueue_email_deliveries(org) — called by the app (user session) right after generate_notifications.
-- One pending email row per unread notification × active member who has an email. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function app.enqueue_email_deliveries(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_count int;
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.org_id = p_org and n.read_at is null
  on conflict (notification_id, channel, target) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Drainer surface (service_role ONLY). claim leases eligible rows atomically (SKIP LOCKED) so two
-- overlapping cron runs never grab the same row — the core of the no-double-send guarantee. It also
-- pushes next_attempt_at forward by the per-attempt backoff, so a crashed send is retried, not stuck.
-- Backoff by the attempt just taken: 1st → 1 min, 2nd → 5 min, 3rd → 30 min. max_attempts caps it.
-- ---------------------------------------------------------------------------
create or replace function app.claim_email_deliveries(p_max int default 25)
returns setof app.notification_delivery
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  return query
  update app.notification_delivery d
     set attempts        = d.attempts + 1,
         last_attempt_at  = now(),
         next_attempt_at  = now() + (case d.attempts + 1
                                       when 1 then interval '1 minute'
                                       when 2 then interval '5 minutes'
                                       else        interval '30 minutes'
                                     end)
   where d.id in (
     select c.id from app.notification_delivery c
     where c.channel = 'email' and c.status = 'pending'
       and c.next_attempt_at <= now() and c.attempts < c.max_attempts
     order by c.created_at
     for update skip locked
     limit greatest(p_max, 0)
   )
  returning d.*;
end;
$$;

-- mark sent — terminal success.
create or replace function app.mark_email_delivery_sent(p_id uuid, p_message_id text, p_response jsonb default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.notification_delivery
     set status = 'sent', sent_at = now(), provider = 'resend',
         provider_message_id = p_message_id,
         provider_response = coalesce(p_response, provider_response),
         last_error = null
   where id = p_id;
end;
$$;

-- mark failed — records the error; goes terminal 'failed' once max_attempts is exhausted, otherwise
-- stays 'pending' (claim already scheduled next_attempt_at for the retry).
create or replace function app.mark_email_delivery_failed(p_id uuid, p_error text, p_response jsonb default null)
returns void language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.notification_delivery d
     set last_error = p_error, provider = 'resend',
         provider_response = coalesce(p_response, d.provider_response),
         status = case when d.attempts >= d.max_attempts then 'failed'::app.delivery_status
                       else 'pending'::app.delivery_status end
   where d.id = p_id;
end;
$$;

revoke all on function app.enqueue_email_deliveries(uuid)                  from public;
revoke all on function app.claim_email_deliveries(int)                     from public;
revoke all on function app.mark_email_delivery_sent(uuid, text, jsonb)     from public;
revoke all on function app.mark_email_delivery_failed(uuid, text, jsonb)   from public;
grant execute on function app.enqueue_email_deliveries(uuid)                to authenticated, service_role;
-- Drainer-only surface: service_role exclusively.
grant execute on function app.claim_email_deliveries(int)                   to service_role;
grant execute on function app.mark_email_delivery_sent(uuid, text, jsonb)   to service_role;
grant execute on function app.mark_email_delivery_failed(uuid, text, jsonb) to service_role;

-- ================================================================
-- 0039_subscription_payments.sql
-- ================================================================
-- 0039_subscription_payments.sql
-- Sprint G: close the billing loop. Automated subscription payment via Moyasar (hosted checkout —
-- card data NEVER touches our servers) plus a thin platform-operator surface for manual overrides.
--
-- Flow: the office (org admin) starts a payment → create_subscription_payment records an intent →
-- the app creates a Moyasar invoice and redirects to the hosted page → Moyasar's webhook calls
-- apply_subscription_payment which ACTIVATES org_subscription (Sprint D) and extends the period.
-- apply/mark are service_role-ONLY and idempotent (the gateway retries webhooks).

do $$ begin
  if not exists (select 1 from pg_type where typname='subscription_payment_status' and typnamespace='app'::regnamespace) then
    create type app.subscription_payment_status as enum ('initiated','paid','failed','refunded');
  end if;
end $$;

create table if not exists app.subscription_payment (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references app.organization(id) on delete cascade,
  plan_code           text not null references app.plan(code),
  amount_halalas      bigint not null,
  currency            text not null default 'SAR',
  gateway             text not null default 'moyasar',
  gateway_payment_id  text unique,                          -- Moyasar invoice/payment id (set at apply)
  status              app.subscription_payment_status not null default 'initiated',
  period_start        timestamptz,
  period_end          timestamptz,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index if not exists subscription_payment_org_idx on app.subscription_payment (org_id, created_at desc);

alter table app.subscription_payment enable row level security;
grant select on app.subscription_payment to authenticated;
-- Payment history is admin-only; writes go through the DEFINER functions below.
drop policy if exists subscription_payment_select on app.subscription_payment;
create policy subscription_payment_select on app.subscription_payment for select
  using (app.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- create_subscription_payment(org, plan) — org admin records a payment intent for a purchasable plan.
-- ---------------------------------------------------------------------------
create or replace function app.create_subscription_payment(p_org uuid, p_plan text)
returns app.subscription_payment
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_plan app.plan;
  v_row  app.subscription_payment;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select * into v_plan from app.plan where code = p_plan;
  if v_plan.code is null then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not v_plan.is_public or v_plan.price_halalas <= 0 then
    raise exception 'PLAN_NOT_PURCHASABLE: % is not self-serve purchasable', p_plan using errcode = 'raise_exception';
  end if;

  insert into app.subscription_payment (org_id, plan_code, amount_halalas, currency, gateway, status)
  values (p_org, v_plan.code, v_plan.price_halalas, 'SAR', 'moyasar', 'initiated')
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_subscription_payment(intent, gateway_id, raw) — the money path. Idempotent: a second call for
-- an already-paid intent is a no-op (the gateway may resend the webhook). Activates the subscription
-- and extends the period by one month from max(now, current period end) so renewals stack correctly.
-- service_role ONLY.
-- ---------------------------------------------------------------------------
create or replace function app.apply_subscription_payment(p_intent uuid, p_gateway_id text, p_raw jsonb default null)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_pay app.subscription_payment;
  v_end timestamptz;
begin
  select * into v_pay from app.subscription_payment where id = p_intent for update;
  if v_pay.id is null then
    raise exception 'PAYMENT_INTENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_pay.status = 'paid' then
    return;  -- already applied → idempotent no-op
  end if;

  v_end := greatest(now(), coalesce((select current_period_end from app.org_subscription where org_id = v_pay.org_id), now()))
           + interval '1 month';

  update app.subscription_payment
     set status = 'paid', paid_at = now(),
         gateway_payment_id = coalesce(p_gateway_id, gateway_payment_id),
         raw = coalesce(p_raw, raw),
         period_start = now(), period_end = v_end
   where id = p_intent;

  update app.org_subscription
     set plan_code = v_pay.plan_code, status = 'active', current_period_end = v_end
   where org_id = v_pay.org_id;
end;
$$;

-- mark a payment failed (non-terminal for already-paid intents).
create or replace function app.mark_subscription_payment_failed(p_intent uuid, p_raw jsonb default null)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  update app.subscription_payment
     set status = 'failed', raw = coalesce(p_raw, raw)
   where id = p_intent and status <> 'paid';
end;
$$;

revoke all on function app.create_subscription_payment(uuid, text)          from public;
revoke all on function app.apply_subscription_payment(uuid, text, jsonb)     from public;
revoke all on function app.mark_subscription_payment_failed(uuid, jsonb)     from public;
grant execute on function app.create_subscription_payment(uuid, text)        to authenticated, service_role;
-- Webhook-only surface: service_role exclusively.
grant execute on function app.apply_subscription_payment(uuid, text, jsonb)  to service_role;
grant execute on function app.mark_subscription_payment_failed(uuid, jsonb)  to service_role;

-- ---------------------------------------------------------------------------
-- Platform operator — a super-admin ABOVE all orgs (the manual Sprint-D levers, now via a UI). The
-- table is DEFINER-only (no RLS policy, no grant); seed your identity by SQL after applying:
--   insert into app.platform_operator(identity_id) values ('<your-auth-uid>');
-- ---------------------------------------------------------------------------
create table if not exists app.platform_operator (
  identity_id uuid primary key references app.identity(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table app.platform_operator enable row level security;  -- no policy → no direct access; DEFINER only

create or replace function app.is_platform_operator() returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (select 1 from app.platform_operator where identity_id = auth.uid());
$$;

-- operator_list_orgs() — every org with its subscription snapshot and live usage.
create or replace function app.operator_list_orgs()
returns table (
  org_id uuid, org_name text, plan_code text, status app.subscription_status,
  trial_ends_at timestamptz, current_period_end timestamptz,
  properties int, units int, members int, created_at timestamptz
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select o.id, o.name, s.plan_code, s.status, s.trial_ends_at, s.current_period_end,
           app.usage_count(o.id,'properties'), app.usage_count(o.id,'units'), app.usage_count(o.id,'members'),
           o.created_at
    from app.organization o
    left join app.org_subscription s on s.org_id = o.id
    where o.deleted_at is null
    order by o.created_at desc;
end;
$$;

-- operator_set_subscription(...) — the manual overrides (comp / extend trial / change plan or status).
-- NULL args leave the current value unchanged.
create or replace function app.operator_set_subscription(
  p_org uuid, p_plan text default null, p_status app.subscription_status default null,
  p_trial_ends_at timestamptz default null, p_period_end timestamptz default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_plan is not null and not exists (select 1 from app.plan where code = p_plan) then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  update app.org_subscription
     set plan_code          = coalesce(p_plan, plan_code),
         status             = coalesce(p_status, status),
         trial_ends_at      = coalesce(p_trial_ends_at, trial_ends_at),
         current_period_end = coalesce(p_period_end, current_period_end),
         notes              = coalesce(p_notes, notes)
   where org_id = p_org;
end;
$$;

-- operator_list_payments(org) — payment history for one org.
create or replace function app.operator_list_payments(p_org uuid)
returns setof app.subscription_payment
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query select * from app.subscription_payment where org_id = p_org order by created_at desc;
end;
$$;

revoke all on function app.is_platform_operator()                                          from public;
revoke all on function app.operator_list_orgs()                                            from public;
revoke all on function app.operator_set_subscription(uuid, text, app.subscription_status, timestamptz, timestamptz, text) from public;
revoke all on function app.operator_list_payments(uuid)                                    from public;
grant execute on function app.is_platform_operator()                                       to authenticated, service_role;
grant execute on function app.operator_list_orgs()                                         to authenticated, service_role;
grant execute on function app.operator_set_subscription(uuid, text, app.subscription_status, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function app.operator_list_payments(uuid)                                 to authenticated, service_role;

-- ================================================================
-- 0040_recurring_billing.sql
-- ================================================================
-- 0040_recurring_billing.sql
-- Sprint H: recurring auto-renew. Saves a Moyasar CARD TOKEN (a reference — never card data) at the
-- first on-session payment, then a daily scheduler charges it off-session at renewal. Dunning on
-- failure: attempts on day 0 / +2 / +5, then the subscription goes `past_due` (which subscription_active
-- already treats as locked — new creation blocked, data kept). Alerts reuse the 0038 email pipeline.

-- ---------------------------------------------------------------------------
-- Saved payment method — the token is an opaque Moyasar reference, NOT a PAN. brand/last4 are display.
-- ---------------------------------------------------------------------------
create table if not exists app.org_payment_method (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references app.organization(id) on delete cascade,
  gateway     text not null default 'moyasar',
  token       text not null,                 -- Moyasar token reference (never card data)
  brand       text,
  last4       text,
  exp_month   int,
  exp_year    int,
  status      text not null default 'active' check (status in ('active','removed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists org_payment_method_one_active on app.org_payment_method (org_id) where status = 'active';

alter table app.org_payment_method enable row level security;
grant select on app.org_payment_method to authenticated;
drop policy if exists org_payment_method_select on app.org_payment_method;
create policy org_payment_method_select on app.org_payment_method for select
  using (app.is_org_admin(org_id));

-- Subscription gains the auto-renew + dunning state.
alter table app.org_subscription add column if not exists auto_renew        boolean not null default false;
alter table app.org_subscription add column if not exists payment_method_id uuid references app.org_payment_method(id);
alter table app.org_subscription add column if not exists dunning_attempts  int not null default 0;
alter table app.org_subscription add column if not exists next_charge_at    timestamptz;

-- Payment gains provenance + dunning attempt number.
alter table app.subscription_payment add column if not exists initiated_by text not null default 'user' check (initiated_by in ('user','auto'));
alter table app.subscription_payment add column if not exists attempt      int  not null default 0;

-- ---------------------------------------------------------------------------
-- Card management (org admin) and token storage (service_role from the webhook).
-- ---------------------------------------------------------------------------
create or replace function app.set_auto_renew(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_on and not exists (select 1 from app.org_payment_method where org_id = p_org and status = 'active') then
    raise exception 'NO_PAYMENT_METHOD: save a card first' using errcode = 'raise_exception';
  end if;
  update app.org_subscription set auto_renew = p_on where org_id = p_org;
end;
$$;

create or replace function app.remove_payment_method(p_org uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.org_payment_method set status = 'removed', updated_at = now() where org_id = p_org and status = 'active';
  update app.org_subscription set auto_renew = false, payment_method_id = null where org_id = p_org;
end;
$$;

-- Store a token captured at checkout (service_role, from the webhook) → enables auto-renew.
create or replace function app.save_payment_method(
  p_org uuid, p_token text, p_brand text default null, p_last4 text default null,
  p_exp_month int default null, p_exp_year int default null
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid;
begin
  update app.org_payment_method set status = 'removed', updated_at = now() where org_id = p_org and status = 'active';
  insert into app.org_payment_method (org_id, token, brand, last4, exp_month, exp_year)
  values (p_org, p_token, p_brand, p_last4, p_exp_month, p_exp_year)
  returning id into v_id;
  update app.org_subscription set payment_method_id = v_id, auto_renew = true where org_id = p_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler surface (service_role). claim_due_renewals atomically leases each due subscription
-- (FOR UPDATE SKIP LOCKED + push next_charge_at forward) and opens an 'auto' payment intent, so two
-- overlapping cron runs never double-charge. Due = auto_renew, active/past_due, has an active token,
-- and (next_charge_at ?? current_period_end) <= now.
-- ---------------------------------------------------------------------------
create or replace function app.claim_due_renewals(p_max int default 25)
returns table (intent_id uuid, org_id uuid, token text, amount_halalas bigint, plan_code text)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r record; v_amt bigint; v_token text; v_intent uuid;
begin
  for r in
    select s.org_id, s.plan_code, s.dunning_attempts, s.payment_method_id
    from app.org_subscription s
    where s.auto_renew
      and s.status in ('active','past_due')
      and exists (select 1 from app.org_payment_method m where m.id = s.payment_method_id and m.status = 'active')
      and coalesce(s.next_charge_at, s.current_period_end) is not null
      and coalesce(s.next_charge_at, s.current_period_end) <= now()
    order by coalesce(s.next_charge_at, s.current_period_end)
    for update of s skip locked
    limit greatest(p_max, 0)
  loop
    select price_halalas into v_amt from app.plan where code = r.plan_code;
    select m.token into v_token from app.org_payment_method m where m.id = r.payment_method_id and m.status = 'active';
    -- Lease so a crashed run retries later, not immediately (resolved by apply/record_dunning_failure).
    update app.org_subscription set next_charge_at = now() + interval '1 hour' where org_subscription.org_id = r.org_id;
    insert into app.subscription_payment (org_id, plan_code, amount_halalas, currency, gateway, status, initiated_by, attempt)
    values (r.org_id, r.plan_code, v_amt, 'SAR', 'moyasar', 'initiated', 'auto', r.dunning_attempts + 1)
    returning id into v_intent;
    intent_id := v_intent; org_id := r.org_id; token := v_token; amount_halalas := v_amt; plan_code := r.plan_code;
    return next;
  end loop;
end;
$$;

-- Enqueue one notification's email deliveries (service_role; ungated core used by dunning/scheduler,
-- since there is no user session in the cron). Mirrors enqueue_email_deliveries for a single row.
create or replace function app.enqueue_notification_email(p_notification_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.id = p_notification_id
  on conflict (notification_id, channel, target) do nothing;
end;
$$;

-- record_dunning_failure — mark the attempt failed, advance the dunning schedule, and alert the office
-- (in-app + email). After the 3rd failed attempt → past_due (locked). service_role.
create or replace function app.record_dunning_failure(p_intent uuid, p_raw jsonb default null) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_org uuid; v_attempt int; v_note uuid;
begin
  select org_id, attempt into v_org, v_attempt from app.subscription_payment where id = p_intent;
  if v_org is null then
    raise exception 'PAYMENT_INTENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  update app.subscription_payment set status = 'failed', raw = coalesce(p_raw, raw)
   where id = p_intent and status <> 'paid';
  update app.org_subscription set dunning_attempts = v_attempt where org_id = v_org;

  if v_attempt >= 3 then
    update app.org_subscription set status = 'past_due', next_charge_at = null where org_id = v_org;
    insert into app.notification (org_id, kind, title, body)
    values (v_org, 'subscription_past_due', 'أُوقف الاشتراك مؤقتاً',
            'تعذّر تجديد اشتراكك بعد عدة محاولات. حدّث بطاقتك أو ادفع يدوياً من صفحة الاشتراك لاستئناف الإنشاء.')
    on conflict do nothing
    returning id into v_note;
  else
    -- schedule the next attempt: after #1 wait 2 days (→ day 2), after #2 wait 3 days (→ day 5).
    update app.org_subscription
       set next_charge_at = now() + (case v_attempt when 1 then interval '2 days' else interval '3 days' end)
     where org_id = v_org;
    insert into app.notification (org_id, kind, entity_type, entity_id, title, body)
    values (v_org, 'billing_failed', 'subscription_payment', p_intent, 'تعذّر تجديد الاشتراك',
            'فشلت محاولة الدفع؛ سنعيد المحاولة تلقائياً. يرجى التأكد من رصيد البطاقة لتفادي إيقاف الحساب.')
    on conflict do nothing
    returning id into v_note;
  end if;

  if v_note is not null then
    perform app.enqueue_notification_email(v_note);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replace apply_subscription_payment (0039) → additionally RESET the dunning state on any success
-- (manual or auto), so a recovered charge clears past_due and re-arms the next cycle from the new
-- period end. Everything else is unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.apply_subscription_payment(p_intent uuid, p_gateway_id text, p_raw jsonb default null)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_pay app.subscription_payment;
  v_end timestamptz;
begin
  select * into v_pay from app.subscription_payment where id = p_intent for update;
  if v_pay.id is null then
    raise exception 'PAYMENT_INTENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_pay.status = 'paid' then
    return;  -- idempotent no-op
  end if;

  v_end := greatest(now(), coalesce((select current_period_end from app.org_subscription where org_id = v_pay.org_id), now()))
           + interval '1 month';

  update app.subscription_payment
     set status = 'paid', paid_at = now(),
         gateway_payment_id = coalesce(p_gateway_id, gateway_payment_id),
         raw = coalesce(p_raw, raw),
         period_start = now(), period_end = v_end
   where id = p_intent;

  update app.org_subscription
     set plan_code = v_pay.plan_code, status = 'active', current_period_end = v_end,
         dunning_attempts = 0, next_charge_at = null
   where org_id = v_pay.org_id;
end;
$$;

-- Replace subscription_summary (0036) → expose auto_renew + the saved card (brand/last4) for the UI.
create or replace function app.subscription_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v jsonb;
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
    'auto_renew',         s.auto_renew,
    'card',               (select jsonb_build_object('brand', m.brand, 'last4', m.last4)
                             from app.org_payment_method m where m.org_id = p_org and m.status = 'active'),
    'limits', jsonb_build_object('properties', pl.max_properties, 'units', pl.max_units, 'members', pl.max_members),
    'usage',  jsonb_build_object(
      'properties', app.usage_count(p_org,'properties'),
      'units',      app.usage_count(p_org,'units'),
      'members',    app.usage_count(p_org,'members'))
  ) into v
  from app.org_subscription s
  join app.plan pl on pl.code = s.plan_code
  where s.org_id = p_org;
  return v;
end;
$$;

revoke all on function app.set_auto_renew(uuid, boolean)                        from public;
revoke all on function app.remove_payment_method(uuid)                          from public;
revoke all on function app.save_payment_method(uuid, text, text, text, int, int) from public;
revoke all on function app.claim_due_renewals(int)                              from public;
revoke all on function app.enqueue_notification_email(uuid)                     from public;
revoke all on function app.record_dunning_failure(uuid, jsonb)                  from public;
grant execute on function app.set_auto_renew(uuid, boolean)                     to authenticated, service_role;
grant execute on function app.remove_payment_method(uuid)                       to authenticated, service_role;
-- Webhook/scheduler-only surface: service_role exclusively.
grant execute on function app.save_payment_method(uuid, text, text, text, int, int) to service_role;
grant execute on function app.claim_due_renewals(int)                           to service_role;
grant execute on function app.enqueue_notification_email(uuid)                   to service_role;
grant execute on function app.record_dunning_failure(uuid, jsonb)                to service_role;

-- ================================================================
-- 0041_roles_matrix.sql
-- ================================================================
-- 0041_roles_matrix.sql
-- Sprint I: a real role → capability matrix, replacing the blunt "everyone-but-viewer can write" rule
-- from 0033. Five capabilities (view / manage_data / manage_finance / manage_team / manage_billing)
-- are mapped to the six roles, and the DB-level RESTRICTIVE write policies are re-expressed per
-- capability: data tables need manage_data, financial tables need manage_finance. `charge` counts as
-- manage_data (it is generated by the contract lifecycle). team/billing stay owner/admin (is_org_admin).
-- Idempotent.

-- The matrix (data — inspectable by the UI's role reference). Seeded here; not writable via the API.
create table if not exists app.role_capability (
  role       app.membership_role not null,
  capability text not null,
  primary key (role, capability)
);
insert into app.role_capability (role, capability) values
  ('owner','view'),('owner','manage_data'),('owner','manage_finance'),('owner','manage_team'),('owner','manage_billing'),
  ('admin','view'),('admin','manage_data'),('admin','manage_finance'),('admin','manage_team'),('admin','manage_billing'),
  ('manager','view'),('manager','manage_data'),('manager','manage_finance'),
  ('accountant','view'),('accountant','manage_finance'),
  ('staff','view'),('staff','manage_data'),
  ('viewer','view')
on conflict do nothing;

alter table app.role_capability enable row level security;
grant select on app.role_capability to authenticated;
drop policy if exists role_capability_select on app.role_capability;
create policy role_capability_select on app.role_capability for select using (true);

-- has_capability(org, cap) — active membership in the active org whose role carries the capability.
create or replace function app.has_capability(p_org uuid, p_capability text) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.has_org_access(p_org)
     and exists (
       select 1
       from app.membership m
       join app.role_capability rc on rc.role = m.role and rc.capability = p_capability
       where m.identity_id = auth.uid() and m.org_id = p_org
         and m.status = 'active' and m.deleted_at is null
     );
$$;

-- current_capabilities(org) — the caller's capability set, for the UI to hide/disable controls.
create or replace function app.current_capabilities(p_org uuid) returns text[]
language sql stable security definer set search_path = app, pg_temp as $$
  select case when app.has_org_access(p_org) then
    coalesce((
      select array_agg(distinct rc.capability)
      from app.membership m
      join app.role_capability rc on rc.role = m.role
      where m.identity_id = auth.uid() and m.org_id = p_org
        and m.status = 'active' and m.deleted_at is null
    ), '{}')
  else '{}' end;
$$;

revoke all on function app.has_capability(uuid, text)      from public;
revoke all on function app.current_capabilities(uuid)      from public;
grant execute on function app.has_capability(uuid, text)   to authenticated, service_role;
grant execute on function app.current_capabilities(uuid)   to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Re-express the RESTRICTIVE write policies per capability (replacing 0033's is_org_writer ones).
-- ---------------------------------------------------------------------------
-- manage_data tables (charge included — generated by contract activation/amendment).
do $$
declare t text;
begin
  foreach t in array array[
    'party','owner','tenant','property','building','unit','unit_status_history',
    'contract','contract_amendment','management_agreement','charge',
    'document','import_batch','import_row'
  ] loop
    execute format('drop policy if exists %I on app.%I', t || '_writer_ins', t);
    execute format('drop policy if exists %I on app.%I', t || '_writer_upd', t);
    execute format('drop policy if exists %I on app.%I', t || '_cap_ins', t);
    execute format('drop policy if exists %I on app.%I', t || '_cap_upd', t);
    execute format('create policy %I on app.%I as restrictive for insert with check (app.has_capability(org_id,''manage_data''))', t || '_cap_ins', t);
    execute format('create policy %I on app.%I as restrictive for update using (app.has_capability(org_id,''manage_data'')) with check (app.has_capability(org_id,''manage_data''))', t || '_cap_upd', t);
  end loop;
end $$;

-- manage_finance tables.
do $$
declare t text;
begin
  foreach t in array array['payment','payment_allocation','invoice','invoice_line','owner_remittance'] loop
    execute format('drop policy if exists %I on app.%I', t || '_writer_ins', t);
    execute format('drop policy if exists %I on app.%I', t || '_writer_upd', t);
    execute format('drop policy if exists %I on app.%I', t || '_cap_ins', t);
    execute format('drop policy if exists %I on app.%I', t || '_cap_upd', t);
    execute format('create policy %I on app.%I as restrictive for insert with check (app.has_capability(org_id,''manage_finance''))', t || '_cap_ins', t);
    execute format('create policy %I on app.%I as restrictive for update using (app.has_capability(org_id,''manage_finance'')) with check (app.has_capability(org_id,''manage_finance''))', t || '_cap_upd', t);
  end loop;
end $$;

-- payment_allocation DELETE → manage_finance.
drop policy if exists payment_allocation_writer_del on app.payment_allocation;
drop policy if exists payment_allocation_cap_del    on app.payment_allocation;
create policy payment_allocation_cap_del on app.payment_allocation as restrictive for delete
  using (app.has_capability(org_id, 'manage_finance'));

-- management_agreement_unit (no org_id) → manage_data via its parent agreement.
drop policy if exists mgmt_unit_writer_ins on app.management_agreement_unit;
drop policy if exists mgmt_unit_writer_upd on app.management_agreement_unit;
drop policy if exists mgmt_unit_writer_del on app.management_agreement_unit;
drop policy if exists mgmt_unit_cap_ins on app.management_agreement_unit;
drop policy if exists mgmt_unit_cap_upd on app.management_agreement_unit;
drop policy if exists mgmt_unit_cap_del on app.management_agreement_unit;
create policy mgmt_unit_cap_ins on app.management_agreement_unit as restrictive for insert
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_capability(a.org_id,'manage_data')));
create policy mgmt_unit_cap_upd on app.management_agreement_unit as restrictive for update
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_capability(a.org_id,'manage_data')))
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_capability(a.org_id,'manage_data')));
create policy mgmt_unit_cap_del on app.management_agreement_unit as restrictive for delete
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.has_capability(a.org_id,'manage_data')));

-- ================================================================
-- 0042_tenant_establishment.sql
-- ================================================================
-- 0042_tenant_establishment.sql
-- Sprint J: richer tenant / commercial-establishment modelling. Purely ADDITIVE and backward
-- compatible — every column is nullable or defaulted, existing rows/contracts are untouched, no data
-- is lost, and no policy changes (party/tenant/contract already carry the 0041 capability policies).
--
-- Design choices that preserve the current architecture:
--   * tenant type is a TEXT + CHECK column (individual / sole_establishment / company), NOT a new
--     value on the app.legal_kind enum — `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
--     block (would break the SQL-Editor/one-shot apply), and a checked text column is just as safe
--     while leaving legal_kind (and the existing tenant_kind) intact for backward compatibility.
--   * establishment identifiers live on app.party (the entity), beside the existing cr_number.
--   * the TRADE/SHOP name and the signing REPRESENTATIVE live on app.contract, so one establishment
--     (party) can hold several contracts, each with its own shop name (شركة الراجحي → مخابز الريان،
--     سوبر ماركت الريان، …). New contract columns are outside the tg_contract_immutable frozen set,
--     so they stay editable (e.g. fixing a typo) without touching the immutability guard.

-- Establishment identifiers on the party (cr_number already exists).
alter table app.party add column if not exists vat_number     text;  -- الرقم الضريبي
alter table app.party add column if not exists unified_number text;  -- الرقم الموحّد (700)
alter table app.party add column if not exists cr_expiry      date;  -- تاريخ انتهاء السجل التجاري

-- Tenant legal form. Backfilled from the existing tenant_kind so current rows keep their meaning.
alter table app.tenant
  add column if not exists tenant_type text not null default 'individual'
    check (tenant_type in ('individual', 'sole_establishment', 'company'));
update app.tenant set tenant_type = 'company' where tenant_kind = 'company' and tenant_type = 'individual';

-- Trade/shop name + signing representative, per contract.
alter table app.contract add column if not exists trade_name             text;  -- اسم المحل التجاري
alter table app.contract add column if not exists representative_name     text;  -- اسم ممثل المنشأة
alter table app.contract add column if not exists representative_capacity text;  -- صفته
alter table app.contract add column if not exists representative_id       text;  -- رقم هويته (اختياري)
alter table app.contract add column if not exists representative_phone    text;  -- جواله (اختياري)

-- ================================================================
-- 0043_payment_method_ejar.sql
-- ================================================================
-- 0043_payment_method_ejar.sql
-- Sprint K: add the Ejar platform as a payment method. PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE
-- inside a transaction block (the new value just can't be USED in the same transaction) — this
-- migration only ADDs it, so it is safe for the one-shot SQL-Editor apply and the test harness.
-- IF NOT EXISTS makes it idempotent. Existing payment rows are untouched.
alter type app.payment_method add value if not exists 'ejar';

-- ================================================================
-- 0044_property_fields.sql
-- ================================================================
-- 0044_property_fields.sql
-- Sprint L (Mogod alignment, Tier A): richer property fields + one-org-per-user. All property columns
-- are ADDITIVE (nullable / defaulted) — no data loss, existing rows/queries untouched. The new fields
-- are PRESENTATION only (like org_type): no RLS/trigger/VAT logic may branch on them (§2 / هـ).

alter table app.property add column if not exists holding_type text not null default 'owned'
  check (holding_type in ('owned', 'managed', 'investment'));   -- مملوك / إدارة أملاك / استثمار
alter table app.property add column if not exists property_code    text;
alter table app.property add column if not exists property_type    text;                 -- برج/مجمّع/مستودع… (عرضي)
alter table app.property add column if not exists occupancy_type   text
  check (occupancy_type is null or occupancy_type in ('family', 'bachelor'));            -- عوائل / عزاب
alter table app.property add column if not exists deed_type        text;
alter table app.property add column if not exists deed_date        date;
alter table app.property add column if not exists water_meter      text;
alter table app.property add column if not exists electricity_meter text;
alter table app.property add column if not exists planned_residential_units int;
alter table app.property add column if not exists planned_commercial_units  int;

-- Backfill holding_type from reality: a property whose owner is NOT the org's self-owner is managed.
update app.property p set holding_type = 'managed'
 where holding_type = 'owned'
   and exists (select 1 from app.owner o where o.id = p.owner_id and o.is_self = false);

-- ---------------------------------------------------------------------------
-- One organization per user: a person may CREATE only one org (they can still be invited into others).
-- Replaces the 0036 definition; the only change is the OWN_ORG_EXISTS guard. Backward compatible —
-- existing multi-org owners keep everything; only a new create call for an already-owner is blocked.
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

  if exists (
    select 1 from app.membership m
    where m.identity_id = v_me and m.role = 'owner' and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'OWN_ORG_EXISTS: a user can create only one organization' using errcode = 'raise_exception';
  end if;

  insert into app.organization (name, org_type) values (p_name, p_org_type) returning id into v_org;

  insert into app.org_subscription (org_id, plan_code, status, trial_ends_at)
  values (v_org, 'basic', 'trialing', now() + interval '30 days');

  insert into app.membership (identity_id, org_id, role, status, scope_all)
  values (v_me, v_org, 'owner', 'active', true);

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

-- ================================================================
-- 0045_contract_numbering_ejar.sql
-- ================================================================
-- 0045_contract_numbering_ejar.sql
-- Two additive changes to app.contract. No data loss; existing contracts keep their numbers.
--
-- 1) Enforced automatic contract numbering. Until now the app only generated a number when the
--    user left the field blank (and it used a raw epoch timestamp), so numbers were inconsistent.
--    Numbering now happens in the DB — the single place that can be atomic — using the same
--    gapless per-(org, year) counter as receipts / invoices / remittances:  CT-YYYY-NNNNN.
--    An explicitly supplied number is respected, so renew_contract (0031) keeps its `<src>-R<year>`.
--
-- 2) Optional "منصة إيجار" alignment block. `ejar_contract_number` already existed (0007); these add
--    the brokerage details + an extra-terms flag. PRESENTATION/ALIGNMENT ONLY — like org_type and
--    holding_type they must never drive RLS, VAT or any business logic. They sit OUTSIDE the frozen
--    column set of tg_contract_immutable (0013), so they stay editable after activation, whereas
--    ejar_contract_number is inside it and therefore freezes with the rest of the legal fields.

-- ---------------------------------------------------------------------------
-- 1. Ejar brokerage block (all nullable / optional)
-- ---------------------------------------------------------------------------
alter table app.contract
  add column if not exists ejar_broker_office         text,
  add column if not exists ejar_broker_number         text,
  add column if not exists ejar_broker_representative text,
  add column if not exists ejar_has_extra_terms       boolean;

comment on column app.contract.ejar_broker_office         is 'اسم مكتب الوساطة في منصة إيجار (اختياري، عرضي فقط)';
comment on column app.contract.ejar_broker_number         is 'رقم مكتب الوساطة (اختياري، عرضي فقط)';
comment on column app.contract.ejar_broker_representative is 'ممثل مكتب الوساطة (اختياري، عرضي فقط)';
comment on column app.contract.ejar_has_extra_terms       is 'هل توجد بنود إضافية في عقد إيجار؟ (اختياري، عرضي فقط)';

-- ---------------------------------------------------------------------------
-- 2. Automatic contract numbering — CT-YYYY-NNNNN
-- ---------------------------------------------------------------------------
create or replace function app.tg_assign_contract_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year text;
  v_seq  bigint;
begin
  -- Only generate when the caller did not supply one (renew_contract supplies '<src>-R<year>').
  if new.contract_number is null or btrim(new.contract_number) = '' then
    v_year := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
    v_seq  := app.next_counter(new.org_id, 'contract:' || v_year);
    new.contract_number := 'CT-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists contract_assign_no on app.contract;
create trigger contract_assign_no
  before insert on app.contract
  for each row execute function app.tg_assign_contract_no();

-- ================================================================
-- 0046_import_parse_hardening.sql
-- ================================================================
-- 0046_import_parse_hardening.sql
-- One malformed cell used to abort the whole import batch.
--
-- app.normalize_date leans on to_date(), which raises (22008) when a field is out of range. A
-- sheet written year-day-month normalizes to '2026/16/06' — month 16. app.import_validate
-- already has a per-row error path for an unparseable date, but the exception escaped the loop
-- before that path could run, so every other row in the file lost its validation too and the
-- caller saw a raw Postgres message with no row number.
--
-- Same shape in app.normalize_amount_halalas: the regexp strip keeps '-' and '.' wherever they
-- appear, so '1.2.3' and '5-3' still reach ::numeric and raise 22P02.
--
-- Both now return null on unparseable input, which is what every caller already treats as
-- "invalid — tell the user which field". Input that parsed before is unaffected.

create or replace function app.normalize_amount_halalas(p_input text) returns bigint
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := replace(s, '٫', '.');                    -- Arabic decimal separator
  s := regexp_replace(s, '[^0-9.\-]', '', 'g'); -- drop currency, commas, spaces
  -- 'ر.س' and 'د.إ' carry a dot, so the strip above leaves one stuck to the number ('1200.50.').
  -- Only a dot between digits can be a decimal separator; an edge dot is always leftover symbol.
  -- Dots in the middle are left alone so '1.2.3' stays ambiguous and is rejected below.
  s := regexp_replace(s, '^\.+|\.+$', '', 'g');

  if s = '' or s = '-' then
    return null;
  end if;

  -- The strip above cannot tell '1.234' from '1.2.3', and the halalas multiply can overflow
  -- bigint on a nonsense figure. Both are caller input, so neither may raise.
  begin
    return round(s::numeric * 100)::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return null;
  end;
end;
$$;

create or replace function app.normalize_date(p_input text) returns date
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := trim(app.fold_digits(p_input));
  s := replace(replace(s, '.', '/'), '\', '/');
  s := replace(s, '-', '/');

  -- Matching the shape does not make the values valid: to_date() raises on month 16, day 32, or
  -- 30 February. Year-day-month sheets ('2026-16-06') are the common case in the field.
  begin
    if s ~ '^\d{4}/\d{1,2}/\d{1,2}$' then
      return to_date(s, 'YYYY/MM/DD');
    elsif s ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      return to_date(s, 'DD/MM/YYYY');
    end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    return null;
  end;

  return null;
end;
$$;

-- ================================================================
-- 0047_import_validate_hardening.sql
-- ================================================================
-- 0047_import_validate_hardening.sql
-- Follow-up to 0046, which fixed the two shared parsers. Three holes were left in the import
-- pipeline itself:
--
-- 1. 'نسبة الضريبة' was cast inline: nullif(app.fold_digits(...), '')::numeric. A '%' sign made
--    it raise and take the whole batch down (the 0046 failure mode, one layer up). Worse, the
--    template documents a fraction (0.15) but people type 15 — and 15 sailed through the cast and
--    multiplied the charge by 15. A silently 100x invoice is a heavier bug than a crash.
--
-- 2. 'المساحة' was never validated at all: import_validate stored the raw string and
--    import_commit cast it with ::numeric. So '120 م²' passed validation, the operator was told
--    the row was valid, pressed «اعتماد» — and the cast raised inside import_commit, which is one
--    transaction by design, rolling back the entire batch with nothing saved. Every field
--    import_commit casts must be proven readable during validation; that was the only one left.
--
-- 3. Nothing bounded the blast radius of a parse hole. Import rows are untrusted input, and two
--    of them have now escaped the row loop, so the loop body converts any remaining conversion
--    error into an error on its own row instead of losing the batch.
--
-- Also folds the shared "read a human-typed number" rule into one function: normalize_decimal.
-- normalize_amount_halalas keeps its exact contract and is now expressed in terms of it.

-- ---------------------------------------------------------------------------
-- Numeric normalization: any human string -> numeric, or null when unreadable.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_decimal(p_input text) returns numeric
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := replace(s, '٫', '.');                    -- Arabic decimal separator
  s := regexp_replace(s, '[^0-9.\-]', '', 'g'); -- drop currency, commas, spaces, units
  -- 'ر.س' and 'م²' leave their dot behind. Only a dot between digits can be a decimal separator;
  -- an edge dot is always leftover symbol. Dots in the middle stay, so '1.2.3' remains ambiguous
  -- and is rejected below rather than silently read as 1.2.
  s := regexp_replace(s, '^\.+|\.+$', '', 'g');

  if s = '' or s = '-' then
    return null;
  end if;

  begin
    return s::numeric;
  exception when data_exception then
    return null;
  end;
end;
$$;

create or replace function app.normalize_amount_halalas(p_input text) returns bigint
language plpgsql immutable as $$
declare
  v numeric;
begin
  v := app.normalize_decimal(p_input);
  if v is null then
    return null;
  end if;
  -- A nonsense figure can still overflow bigint on the halalas multiply.
  begin
    return round(v * 100)::bigint;
  exception when numeric_value_out_of_range then
    return null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tax rate: text -> fraction in 0..1, or null when unreadable.
-- The template documents 0.15, but 15, 15% and ٪١٥ are what people actually type. Reading a bare
-- 15 as a rate of 15 multiplies the charge by fifteen, so any value at or above 1 — and any value
-- carrying a percent sign — is read as a percentage. This makes a rate of exactly 100%
-- inexpressible, which no tax authority charges, and in exchange no invoice can be inflated 100x.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_rate(p_input text) returns numeric
language plpgsql immutable as $$
declare
  v numeric;
begin
  v := app.normalize_decimal(p_input);
  if v is null then
    return null;
  end if;
  if v >= 1 or p_input ~ '[%٪]' then
    v := v / 100;
  end if;
  if v < 0 or v > 1 then
    return null;
  end if;
  return v;
end;
$$;

-- ===========================================================================
-- import_validate — normalize every row, collect per-field errors, resolve references.
-- Re-emitted from 0016 with: a validated 'المساحة', a validated 'نسبة الضريبة', date errors that
-- state the accepted format, and a per-row guard around the body.
-- ===========================================================================
create or replace function app.import_validate(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  r      app.import_row;
  norm   jsonb;
  errs   jsonb;
  s      text;
  amt    bigint;
  num    numeric;
  ph     text;
  d1     date;
  d2     date;
  ref_id uuid;
  ref2   uuid;
  n_valid int := 0;
  n_error int := 0;
  n_total int := 0;
begin
  select org_id, kind into v_org, v_kind from app.import_batch where id = p_batch;
  if v_org is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch order by row_number loop
    n_total := n_total + 1;

    -- One unreadable cell fails its own row. Every conversion below is meant to be guarded
    -- already; this is the boundary that keeps the next missed one from costing the batch.
    begin
      norm := '{}'::jsonb;
      errs := '[]'::jsonb;

      if v_kind = 'properties' then
        s := nullif(trim(r.raw->>'اسم العقار'), '');
        if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('name', s); end if;
        norm := norm || jsonb_build_object(
          'property_kind', app.map_property_kind(r.raw->>'نوع العقار'),
          'deed_number',   nullif(trim(r.raw->>'رقم الصك'), ''),
          'city',          nullif(trim(r.raw->>'المدينة'), ''),
          'district',      nullif(trim(r.raw->>'الحي'), ''),
          'address_line',  nullif(trim(r.raw->>'العنوان'), ''),
          'owner_name',    nullif(trim(r.raw->>'اسم المالك'), ''));

      elsif v_kind = 'owners' then
        s := nullif(trim(r.raw->>'الاسم'), '');
        if s is null then errs := errs || app.import_err('الاسم', r.raw->>'الاسم', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('display_name', s); end if;
        ph := r.raw->>'الجوال';
        if ph is not null and trim(ph) <> '' then
          if app.normalize_phone_e164(ph) is null
            then errs := errs || app.import_err('الجوال', ph, 'رقم جوال غير صالح');
            else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(ph), 'phone_raw', ph);
          end if;
        end if;
        norm := norm || jsonb_build_object(
          'legal_kind', app.map_legal_kind(r.raw->>'النوع'),
          'national_id', nullif(trim(r.raw->>'رقم الهوية'), ''),
          'iban', nullif(trim(r.raw->>'الآيبان'), ''),
          'bank_name', nullif(trim(r.raw->>'البنك'), ''));

      elsif v_kind = 'tenants' then
        s := nullif(trim(r.raw->>'الاسم'), '');
        if s is null then errs := errs || app.import_err('الاسم', r.raw->>'الاسم', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('display_name', s); end if;
        ph := coalesce(r.raw->>'الجوال', '');
        if trim(ph) <> '' then
          if app.normalize_phone_e164(ph) is null
            then errs := errs || app.import_err('الجوال', ph, 'رقم جوال غير صالح');
            else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(ph), 'phone_raw', ph);
          end if;
        end if;
        norm := norm || jsonb_build_object(
          'legal_kind', app.map_legal_kind(r.raw->>'النوع'),
          'national_id', nullif(trim(coalesce(r.raw->>'رقم الهوية', r.raw->>'رقم الإقامة')), ''),
          'email', nullif(trim(r.raw->>'البريد الإلكتروني'), ''));

      elsif v_kind = 'units' then
        s := nullif(trim(r.raw->>'اسم العقار'), '');
        if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
        else
          select id into ref_id from app.property
            where org_id = v_org and name = s and deleted_at is null limit 1;
          if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود في المنصة');
          else norm := norm || jsonb_build_object('property_id', ref_id); end if;
        end if;
        s := nullif(trim(r.raw->>'رقم الوحدة'), '');
        if s is null then errs := errs || app.import_err('رقم الوحدة', r.raw->>'رقم الوحدة', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('unit_number', s); end if;
        -- Optional, but import_commit casts it to numeric — so prove it is readable here.
        s := nullif(trim(r.raw->>'المساحة'), '');
        if s is not null then
          num := app.normalize_decimal(s);
          if num is null or num < 0 then errs := errs || app.import_err('المساحة', s, 'مساحة غير صالحة');
          else norm := norm || jsonb_build_object('area_sqm', num); end if;
        end if;
        norm := norm || jsonb_build_object(
          'floor', nullif(trim(r.raw->>'الدور'), ''),
          'current_status', app.map_unit_status(r.raw->>'الحالة'));

      elsif v_kind = 'contracts' then
        s := nullif(trim(r.raw->>'رقم العقد'), '');
        if s is null then errs := errs || app.import_err('رقم العقد', r.raw->>'رقم العقد', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('contract_number', s); end if;
        -- property
        s := nullif(trim(r.raw->>'اسم العقار'), '');
        select id into ref_id from app.property where org_id = v_org and name = s and deleted_at is null limit 1;
        if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود');
        else
          norm := norm || jsonb_build_object('property_id', ref_id);
          -- unit within property
          s := nullif(trim(r.raw->>'رقم الوحدة'), '');
          select id into ref2 from app.unit where property_id = ref_id and unit_number = s and deleted_at is null limit 1;
          if ref2 is null then errs := errs || app.import_err('رقم الوحدة', s, 'الوحدة غير موجودة في هذا العقار');
          else norm := norm || jsonb_build_object('unit_id', ref2); end if;
        end if;
        -- tenant by national id or name
        s := nullif(trim(r.raw->>'رقم هوية المستأجر'), '');
        ref_id := null;
        if s is not null then
          select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
            where t.org_id = v_org and p.national_id = s and t.deleted_at is null limit 1;
        end if;
        if ref_id is null then
          s := nullif(trim(r.raw->>'اسم المستأجر'), '');
          select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
            where t.org_id = v_org and p.display_name = s and t.deleted_at is null limit 1;
        end if;
        if ref_id is null then errs := errs || app.import_err('المستأجر', coalesce(r.raw->>'اسم المستأجر', r.raw->>'رقم هوية المستأجر'), 'المستأجر غير موجود');
        else norm := norm || jsonb_build_object('tenant_id', ref_id); end if;
        -- dates
        d1 := app.normalize_date(r.raw->>'تاريخ البداية');
        d2 := app.normalize_date(r.raw->>'تاريخ النهاية');
        if d1 is null then errs := errs || app.import_err('تاريخ البداية', r.raw->>'تاريخ البداية', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('start_date', d1); end if;
        if d2 is null then errs := errs || app.import_err('تاريخ النهاية', r.raw->>'تاريخ النهاية', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('end_date', d2); end if;
        if d1 is not null and d2 is not null and d2 < d1 then
          errs := errs || app.import_err('تاريخ النهاية', d2::text, 'تاريخ النهاية قبل البداية');
        end if;
        -- amounts
        amt := app.normalize_amount_halalas(r.raw->>'الإيجار السنوي');
        if amt is null then errs := errs || app.import_err('الإيجار السنوي', r.raw->>'الإيجار السنوي', 'مبلغ غير صالح');
        else norm := norm || jsonb_build_object('annual_rent_halalas', amt); end if;
        norm := norm || jsonb_build_object(
          'deposit_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'التأمين'), 0),
          'service_fees_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'رسوم الخدمات'), 0),
          'payment_frequency', app.map_payment_frequency(r.raw->>'دورية الدفع'),
          'ejar_contract_number', nullif(trim(r.raw->>'رقم عقد إيجار'), ''),
          'deed_number', nullif(trim(r.raw->>'رقم الصك'), ''));

      elsif v_kind = 'charges' then
        s := nullif(trim(r.raw->>'رقم العقد'), '');
        select id into ref_id from app.contract
          where org_id = v_org and contract_number = s and deleted_at is null limit 1;
        if ref_id is null then errs := errs || app.import_err('رقم العقد', s, 'العقد غير موجود');
        else
          norm := norm || jsonb_build_object('contract_id', ref_id);
          norm := norm || (select jsonb_build_object('property_id', property_id, 'unit_id', unit_id)
                           from app.contract where id = ref_id);
        end if;
        if app.map_charge_type(r.raw->>'نوع الاستحقاق') is null then
          errs := errs || app.import_err('نوع الاستحقاق', r.raw->>'نوع الاستحقاق', 'نوع غير معروف');
        else norm := norm || jsonb_build_object('charge_type', app.map_charge_type(r.raw->>'نوع الاستحقاق')); end if;
        d1 := app.normalize_date(r.raw->>'تاريخ الاستحقاق');
        if d1 is null then errs := errs || app.import_err('تاريخ الاستحقاق', r.raw->>'تاريخ الاستحقاق', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('due_date', d1); end if;
        -- VAT rate defaults to 0 (residential rent is exempt); the sheet may override it.
        s := nullif(trim(r.raw->>'نسبة الضريبة'), '');
        if s is null then num := 0;
        else
          num := app.normalize_rate(s);
          if num is null then
            errs := errs || app.import_err('نسبة الضريبة', s, 'نسبة غير صالحة — اكتب 0.15 أو 15%');
          end if;
        end if;
        amt := app.normalize_amount_halalas(r.raw->>'المبلغ قبل الضريبة');
        if amt is null then errs := errs || app.import_err('المبلغ قبل الضريبة', r.raw->>'المبلغ قبل الضريبة', 'مبلغ غير صالح');
        elsif num is not null then
          norm := norm || jsonb_build_object(
            'amount_excl_vat_halalas', amt,
            'vat_rate', num,
            'vat_amount_halalas', round(amt * num)::bigint);
        end if;
        norm := norm || jsonb_build_object('description', nullif(trim(r.raw->>'الوصف'), ''));
      end if;

      update app.import_row
        set normalized = norm, errors = errs, is_valid = (jsonb_array_length(errs) = 0)
        where id = r.id;
      if jsonb_array_length(errs) = 0 then n_valid := n_valid + 1; else n_error := n_error + 1; end if;

    exception when data_exception then
      update app.import_row
        set normalized = '{}'::jsonb,
            errors = jsonb_build_array(app.import_err('الصف', null::text, 'تعذّرت قراءة هذا الصف: ' || sqlerrm)),
            is_valid = false
        where id = r.id;
      n_error := n_error + 1;
    end;
  end loop;

  update app.import_batch
    set status = 'validated', total_rows = n_total, valid_rows = n_valid, error_rows = n_error
    where id = p_batch;
end;
$$;

-- ================================================================
-- 0048_platform_foundation.sql
-- ================================================================
-- 0048_platform_foundation.sql
-- Sprint T-0 — the foundation the super-admin console stands on. No UI-facing feature here; this
-- closes the three things that made the console impossible to build honestly:
--
-- 1. THE HISTORY GAP. app.org_subscription is overwritten in place, so churn, growth, MRR trend and
--    "when did this office upgrade" were not computable — the data never existed. app.subscription_event
--    is an append-only log written by a TRIGGER on org_subscription, so it captures every change
--    whatever made it (operator RPC, billing engine, webhook, manual SQL) with no call site to
--    remember to instrument. The plan's list price is SNAPSHOTTED on each row so re-pricing a plan
--    later cannot rewrite past revenue.
--
-- 2. THE AUDIT GAP (Charter §11.5). operator_set_subscription changes a customer's plan or suspends
--    their account and wrote NO audit trail. It does now — an Audit Center with nothing to show
--    would have been theatre.
--
-- 3. THE SCALE GAP. operator_list_orgs() returned EVERY org, each with three usage counts. At a
--    thousand offices that is a thousand round trips through three counting queries on every page
--    view. Replaced by app.platform_list_orgs(...) — searchable, filterable, paged, one call, and it
--    carries the plan limits so the console can draw usage against them.
--
-- Access model unchanged and non-negotiable: every platform function is SECURITY DEFINER with
-- `if not app.is_platform_operator() then raise FORBIDDEN` as its FIRST statement, revoked from
-- public. Nothing here reads a tenant's rows — only counts and platform-owned records.

-- ---------------------------------------------------------------------------
-- subscription_event — append-only subscription history. Platform-only: RLS on with NO policy, so
-- it is unreachable except through the SECURITY DEFINER readers below.
-- ---------------------------------------------------------------------------
create table if not exists app.subscription_event (
  id                  bigint generated always as identity primary key,
  org_id              uuid not null references app.organization(id) on delete cascade,
  kind                text not null check (kind in
                        ('created','plan_changed','status_changed','trial_extended','period_extended')),
  from_plan           text,
  to_plan             text,
  from_status         app.subscription_status,
  to_status           app.subscription_status,
  -- The plan's list price AT THIS MOMENT. Not "MRR": which statuses count as revenue is a reporting
  -- decision that belongs in the KPI query, not frozen into the log.
  plan_price_halalas  bigint not null default 0,
  actor_identity_id   uuid,
  detail              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists subscription_event_org_idx  on app.subscription_event (org_id, created_at desc);
create index if not exists subscription_event_time_idx on app.subscription_event (created_at desc);

alter table app.subscription_event enable row level security;  -- no policy → DEFINER-only, like platform_operator

create or replace function app.tg_subscription_event_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'SUBSCRIPTION_EVENT_APPEND_ONLY: subscription_event rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

drop trigger if exists subscription_event_immutable on app.subscription_event;
create trigger subscription_event_immutable before update or delete on app.subscription_event
  for each row execute function app.tg_subscription_event_immutable();

-- Capture trigger. A single UPDATE can change several fields at once (operator_set_subscription sets
-- plan and status together), so `kind` names the most significant change while from_/to_ columns
-- record every one of them — no information is lost by the labelling.
create or replace function app.tg_subscription_event() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_kind  text;
  v_price bigint;
begin
  if tg_op = 'INSERT' then
    v_kind := 'created';
  elsif new.plan_code          is distinct from old.plan_code          then v_kind := 'plan_changed';
  elsif new.status             is distinct from old.status             then v_kind := 'status_changed';
  elsif new.trial_ends_at      is distinct from old.trial_ends_at      then v_kind := 'trial_extended';
  elsif new.current_period_end is distinct from old.current_period_end then v_kind := 'period_extended';
  else
    return null;  -- e.g. a notes-only edit: nothing worth a history row
  end if;

  select price_halalas into v_price from app.plan where code = new.plan_code;

  insert into app.subscription_event (
    org_id, kind, from_plan, to_plan, from_status, to_status,
    plan_price_halalas, actor_identity_id, detail)
  values (
    new.org_id, v_kind,
    case when tg_op = 'UPDATE' then old.plan_code end, new.plan_code,
    case when tg_op = 'UPDATE' then old.status    end, new.status,
    coalesce(v_price, 0), auth.uid(),
    jsonb_build_object('trial_ends_at', new.trial_ends_at, 'current_period_end', new.current_period_end));
  return null;
end;
$$;

drop trigger if exists org_subscription_event on app.org_subscription;
create trigger org_subscription_event after insert or update on app.org_subscription
  for each row execute function app.tg_subscription_event();

-- Seed one 'created' row per subscription that predates the trigger, so today's state has an origin
-- on the timeline. This is a RECONSTRUCTION from the current row, not recovered history — history was
-- never stored and no query can invent it; `detail.reconstructed` marks these so a chart can say so.
-- On a fresh database the trigger above has already supplied the origin row and this is a no-op, so
-- the invariant to hold onto is "every subscription has an origin event", whichever wrote it.
insert into app.subscription_event (org_id, kind, to_plan, to_status, plan_price_halalas, detail, created_at)
select s.org_id, 'created', s.plan_code, s.status, coalesce(p.price_halalas, 0),
       jsonb_build_object('reconstructed', true), s.created_at
  from app.org_subscription s
  left join app.plan p on p.code = s.plan_code
 where not exists (select 1 from app.subscription_event e where e.org_id = s.org_id);

-- ---------------------------------------------------------------------------
-- Platform readers.
-- ---------------------------------------------------------------------------

-- platform_org_activity() — last sign-in and today's active users per org, from auth.users.
-- auth.users exists on Supabase but not on bare Postgres (the test harness), so the table is
-- resolved at runtime and its absence returns no rows rather than an error: the console degrades to
-- "—" instead of failing.
create or replace function app.platform_org_activity()
returns table (org_id uuid, last_sign_in_at timestamptz, active_today int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if to_regclass('auth.users') is null then
    return;
  end if;
  return query execute $q$
    select m.org_id,
           max(u.last_sign_in_at),
           count(*) filter (
             where (u.last_sign_in_at at time zone 'Asia/Riyadh')::date
                 = (now() at time zone 'Asia/Riyadh')::date)::int
      from app.membership m
      join auth.users u on u.id = m.identity_id
     where m.status = 'active' and m.deleted_at is null
     group by m.org_id
  $q$;
end;
$$;

-- platform_list_orgs(...) — one paged, searchable, filterable page of the tenant list, carrying the
-- plan limits so usage can be drawn against them. total_count is the size of the FILTERED set,
-- repeated on every row (window function) so the caller gets it without a second query.
-- p_org narrows to a single office, so the detail page reads the SAME row shape as the list rather
-- than a near-copy of this query living somewhere else.
drop function if exists app.platform_list_orgs(uuid, text, app.subscription_status, int, int);
create or replace function app.platform_list_orgs(
  p_org    uuid default null,
  p_search text default null,
  p_status app.subscription_status default null,
  p_limit  int default 20,
  p_offset int default 0
)
returns table (
  org_id uuid, org_name text, created_at timestamptz,
  plan_code text, plan_name_ar text, plan_price_halalas bigint,
  status app.subscription_status, trial_ends_at timestamptz, current_period_end timestamptz,
  properties int, units int, members int,
  max_properties int, max_units int, max_members int,
  last_sign_in_at timestamptz, active_today int,
  total_count bigint
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with matched as (
      select o.id, o.name, o.created_at, s.plan_code, s.status, s.trial_ends_at, s.current_period_end
        from app.organization o
        left join app.org_subscription s on s.org_id = o.id
       where o.deleted_at is null
         and (p_org    is null or o.id = p_org)
         and (p_search is null or o.name ilike '%' || p_search || '%')
         and (p_status is null or s.status = p_status)
    ),
    page as (
      select m.*, count(*) over () as total
        from matched m
       order by m.created_at desc
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    )
    select pg.id, pg.name, pg.created_at,
           pg.plan_code, pl.name_ar, pl.price_halalas,
           pg.status, pg.trial_ends_at, pg.current_period_end,
           app.usage_count(pg.id, 'properties'), app.usage_count(pg.id, 'units'), app.usage_count(pg.id, 'members'),
           pl.max_properties, pl.max_units, pl.max_members,
           act.last_sign_in_at, coalesce(act.active_today, 0),
           pg.total
      from page pg
      left join app.plan pl on pl.code = pg.plan_code
      left join app.platform_org_activity() act on act.org_id = pg.id
     order by pg.created_at desc;
end;
$$;

-- Superseded by platform_list_orgs: unpaged, and it could not carry limits or activity.
drop function if exists app.operator_list_orgs();

-- platform_subscription_history(org) — the timeline behind one office.
create or replace function app.platform_subscription_history(p_org uuid)
returns setof app.subscription_event
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select * from app.subscription_event where org_id = p_org order by created_at desc, id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- write_audit — corrects a latent mis-stamping that only surfaced once a platform action existed.
-- membership_id was taken from app.current_membership_id(), which resolves against the CURRENT
-- x-active-org header, not against p_org. For office actions the two always agree, so this never
-- bit. For a platform action on another org — or for org.create, where the audited org is the one
-- just born — it stamped the operator's membership in a DIFFERENT org, reading as though that
-- membership had acted on this org. The membership is now recorded only when it actually belongs to
-- the org being audited; otherwise NULL, which is the honest answer and the marker of a platform
-- action. Everything else about the function is unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.write_audit(
  p_org uuid, p_action text, p_entity_type text default null,
  p_entity_id uuid default null, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
begin
  insert into app.audit_log (org_id, identity_id, membership_id, action, entity_type, entity_id, detail)
  values (
    p_org,
    auth.uid(),
    case when p_org is not null and p_org = app.current_org_id()
         then app.current_membership_id() end,
    p_action, p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- operator_set_subscription — unchanged behaviour, plus the audit trail it always should have had.
-- ---------------------------------------------------------------------------
create or replace function app.operator_set_subscription(
  p_org uuid, p_plan text default null, p_status app.subscription_status default null,
  p_trial_ends_at timestamptz default null, p_period_end timestamptz default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_before app.org_subscription;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_plan is not null and not exists (select 1 from app.plan where code = p_plan) then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  select * into v_before from app.org_subscription where org_id = p_org;
  if v_before.org_id is null then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  update app.org_subscription
     set plan_code          = coalesce(p_plan, plan_code),
         status             = coalesce(p_status, status),
         trial_ends_at      = coalesce(p_trial_ends_at, trial_ends_at),
         current_period_end = coalesce(p_period_end, current_period_end),
         notes              = coalesce(p_notes, notes)
   where org_id = p_org;

  perform app.write_audit(p_org, 'platform.subscription_update', 'org_subscription', p_org,
    jsonb_build_object(
      'before', jsonb_build_object('plan', v_before.plan_code, 'status', v_before.status,
                                   'trial_ends_at', v_before.trial_ends_at,
                                   'current_period_end', v_before.current_period_end),
      'requested', jsonb_build_object('plan', p_plan, 'status', p_status,
                                      'trial_ends_at', p_trial_ends_at, 'period_end', p_period_end,
                                      'notes', p_notes)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Same shape as every platform function: nothing to public; the FORBIDDEN gate inside each
-- function is what actually authorizes, not the grant.
-- ---------------------------------------------------------------------------
revoke all on function app.platform_org_activity()                                  from public;
revoke all on function app.platform_list_orgs(uuid, text, app.subscription_status, int, int) from public;
revoke all on function app.platform_subscription_history(uuid)                      from public;
grant execute on function app.platform_org_activity()                               to authenticated, service_role;
grant execute on function app.platform_list_orgs(uuid, text, app.subscription_status, int, int) to authenticated, service_role;
grant execute on function app.platform_subscription_history(uuid)                   to authenticated, service_role;

-- ================================================================
-- 0049_platform_kpis.sql
-- ================================================================
-- 0049_platform_kpis.sql
-- Sprint T-1 — the read side of the executive dashboard. Four functions, one contract each
-- (ADR-0006): SECURITY DEFINER, `FORBIDDEN` as the first statement, revoked from public, and every
-- figure is either platform-owned data or a COUNT of tenant data. Not one tenant row leaves here.
--
-- Two honesty rules are enforced in SQL rather than left to the UI:
--   • MRR counts `active` only. A trial pays nothing and a comp is a grant, so folding either into
--     recurring revenue would inflate it. `past_due` is contracted but not collecting, so it is
--     reported separately as revenue at risk instead of being quietly counted or quietly dropped.
--   • trend_since is the oldest REAL subscription event. The 0048 back-seed is dated to each
--     subscription's creation, so measuring "history" from it would claim months of trend we never
--     recorded. Reconstructed rows are excluded, and NULL means recording just started.

-- ---------------------------------------------------------------------------
-- platform_kpis() — every scalar on the dashboard in one round trip.
-- ---------------------------------------------------------------------------
create or replace function app.platform_kpis()
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_month_start date := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
  v_prev_start  date := (date_trunc('month', (now() at time zone 'Asia/Riyadh')) - interval '1 month')::date;
  v_window      timestamptz := now() - interval '30 days';
  v_mrr         bigint;
  v_at_risk     bigint;
  v_active      int;
  v_canceled30  int;
  v_activated30 int;
  v_base        int;
  v_new_month   int;
  v_new_prev    int;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select coalesce(sum(p.price_halalas) filter (where s.status = 'active'), 0),
         coalesce(sum(p.price_halalas) filter (where s.status = 'past_due'), 0),
         count(*) filter (where s.status = 'active')::int
    into v_mrr, v_at_risk, v_active
    from app.org_subscription s
    join app.organization o on o.id = s.org_id and o.deleted_at is null
    left join app.plan p on p.code = s.plan_code;

  select count(distinct org_id) filter (where to_status = 'canceled'),
         count(distinct org_id) filter (where to_status = 'active')
    into v_canceled30, v_activated30
    from app.subscription_event
   where kind = 'status_changed' and created_at >= v_window;

  -- Customers at the start of the window, reconstructed from where we are now: those active today,
  -- minus the ones that became active during it, plus the ones that left during it.
  v_base := v_active - coalesce(v_activated30, 0) + coalesce(v_canceled30, 0);

  select count(*) filter (where (created_at at time zone 'Asia/Riyadh')::date >= v_month_start)::int,
         count(*) filter (where (created_at at time zone 'Asia/Riyadh')::date >= v_prev_start
                            and (created_at at time zone 'Asia/Riyadh')::date <  v_month_start)::int
    into v_new_month, v_new_prev
    from app.organization where deleted_at is null;

  return jsonb_build_object(
    'mrr_halalas',          v_mrr,
    'mrr_at_risk_halalas',  v_at_risk,
    'arr_halalas',          v_mrr * 12,
    'orgs_total',           (select count(*) from app.organization where deleted_at is null),
    'orgs_active',          v_active,
    'orgs_trialing',        (select count(*) from app.org_subscription where status = 'trialing'),
    'orgs_comped',          (select count(*) from app.org_subscription where status = 'comped'),
    'orgs_past_due',        (select count(*) from app.org_subscription where status = 'past_due'),
    'orgs_canceled',        (select count(*) from app.org_subscription where status = 'canceled'),
    'trials_expiring_7d',   (select count(*) from app.org_subscription
                              where status = 'trialing' and trial_ends_at is not null
                                and trial_ends_at between now() and now() + interval '7 days'),
    'subs_expiring_30d',    (select count(*) from app.org_subscription
                              where status = 'active' and current_period_end is not null
                                and current_period_end between now() and now() + interval '30 days'),
    'canceled_30d',         coalesce(v_canceled30, 0),
    'activated_30d',        coalesce(v_activated30, 0),
    'churn_rate_30d',       case when v_base > 0
                                 then round(coalesce(v_canceled30, 0)::numeric / v_base, 4) end,
    'new_orgs_month',       v_new_month,
    'new_orgs_prev_month',  v_new_prev,
    'growth_rate_month',    case when v_new_prev > 0
                                 then round((v_new_month - v_new_prev)::numeric / v_new_prev, 4) end,
    'revenue_month_halalas',(select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                              where status = 'paid' and paid_at is not null
                                and (paid_at at time zone 'Asia/Riyadh')::date >= v_month_start),
    'revenue_prev_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                              where status = 'paid' and paid_at is not null
                                and (paid_at at time zone 'Asia/Riyadh')::date >= v_prev_start
                                and (paid_at at time zone 'Asia/Riyadh')::date <  v_month_start),
    'failed_payments_30d',  (select count(*) from app.subscription_payment
                              where status = 'failed' and created_at >= v_window),
    'properties',           (select count(*) from app.property where deleted_at is null),
    'units',                (select count(*) from app.unit     where deleted_at is null),
    'contracts',            (select count(*) from app.contract where deleted_at is null),
    'users',                (select count(distinct identity_id) from app.membership
                              where status = 'active' and deleted_at is null),
    'active_today',         (select coalesce(sum(active_today), 0) from app.platform_org_activity()),
    'trend_since',          (select min(created_at) from app.subscription_event
                              where coalesce((detail->>'reconstructed')::boolean, false) = false),
    'generated_at',         now());
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_revenue_series(months) — collected revenue and new offices per month, oldest first.
-- Months with nothing in them are still returned: a gap in a trend line must read as zero, not as
-- an absent point that the chart would silently close over.
-- ---------------------------------------------------------------------------
create or replace function app.platform_revenue_series(p_months int default 12)
returns table (month_start date, paid_halalas bigint, payments int, new_orgs int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with months as (
      select generate_series(
               date_trunc('month', (now() at time zone 'Asia/Riyadh'))
                 - make_interval(months => greatest(p_months, 1) - 1),
               date_trunc('month', (now() at time zone 'Asia/Riyadh')),
               interval '1 month')::date as m
    )
    select months.m,
           coalesce((select sum(sp.amount_halalas) from app.subscription_payment sp
                      where sp.status = 'paid' and sp.paid_at is not null
                        and date_trunc('month', (sp.paid_at at time zone 'Asia/Riyadh'))::date = months.m), 0)::bigint,
           coalesce((select count(*) from app.subscription_payment sp
                      where sp.status = 'paid' and sp.paid_at is not null
                        and date_trunc('month', (sp.paid_at at time zone 'Asia/Riyadh'))::date = months.m), 0)::int,
           coalesce((select count(*) from app.organization o
                      where o.deleted_at is null
                        and date_trunc('month', (o.created_at at time zone 'Asia/Riyadh'))::date = months.m), 0)::int
      from months
     order by months.m;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_plan_distribution() — how the customer base sits across the catalog. Every plan is
-- returned, including the ones nobody is on: an empty tier is itself the answer to "is anyone
-- buying Enterprise".
-- ---------------------------------------------------------------------------
create or replace function app.platform_plan_distribution()
returns table (plan_code text, plan_name_ar text, price_halalas bigint,
               orgs int, orgs_active int, mrr_halalas bigint)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select p.code, p.name_ar, p.price_halalas,
           count(s.org_id)::int,
           count(s.org_id) filter (where s.status = 'active')::int,
           (count(s.org_id) filter (where s.status = 'active') * p.price_halalas)::bigint
      from app.plan p
      left join app.org_subscription s on s.plan_code = p.code
      left join app.organization o on o.id = s.org_id and o.deleted_at is null
     group by p.code, p.name_ar, p.price_halalas, p.sort
     order by p.sort;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_top_customers(limit) — by what they have actually paid us, not by what they were billed.
-- ---------------------------------------------------------------------------
create or replace function app.platform_top_customers(p_limit int default 5)
returns table (org_id uuid, org_name text, plan_code text, paid_halalas bigint, payments int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select o.id, o.name, s.plan_code,
           coalesce(sum(sp.amount_halalas), 0)::bigint,
           count(sp.id)::int
      from app.organization o
      left join app.org_subscription s on s.org_id = o.id
      left join app.subscription_payment sp on sp.org_id = o.id and sp.status = 'paid'
     where o.deleted_at is null
     group by o.id, o.name, s.plan_code
    having coalesce(sum(sp.amount_halalas), 0) > 0
     order by 4 desc
     limit greatest(p_limit, 1);
end;
$$;

revoke all on function app.platform_kpis()                  from public;
revoke all on function app.platform_revenue_series(int)     from public;
revoke all on function app.platform_plan_distribution()     from public;
revoke all on function app.platform_top_customers(int)      from public;
grant execute on function app.platform_kpis()               to authenticated, service_role;
grant execute on function app.platform_revenue_series(int)  to authenticated, service_role;
grant execute on function app.platform_plan_distribution()  to authenticated, service_role;
grant execute on function app.platform_top_customers(int)   to authenticated, service_role;

-- ================================================================
-- 0050_platform_tenant_360.sql
-- ================================================================
-- 0050_platform_tenant_360.sql
-- Sprint T-2 — everything the console needs to look at ONE office, plus the two operator actions
-- that were not expressible before.
--
-- 1. A new subscription status: `suspended`. Until now "cut this office off" could only be spelled
--    `canceled`, which says the customer LEFT. They are different facts and conflating them
--    corrupts churn: a suspension for non-payment would have counted as a customer lost. Nothing
--    else needs to change — app.subscription_active() lists the live statuses explicitly and fails
--    closed on anything else, so `suspended` locks new business creation the moment it exists while
--    all existing data stays readable and editable (Charter ق-هـ).
--
-- 2. operator_extend_trial(org, days) — the one-click lever. Extending from the LATER of now and the
--    current end date matters: extending an already-lapsed trial by 14 days from its old end date
--    would hand the office a trial that expired yesterday.
--
-- 3. platform_tenant_360(org) — one call, the whole office. Bound by ADR-0006: the office's own
--    PORTFOLIO is returned as counts, never rows, and not one riyal of the office's own money
--    appears here. `revenue` in this payload is what the office paid US.
--
--    One clarification this sprint forces into the open: the office's TEAM (the identities that log
--    into our platform, with their role and last sign-in) is relationship data, not tenant-owned
--    data — support cannot help an office without knowing who to call. The office's own customers,
--    the owners and tenants whose data they hold, remain counts and nothing else. That line is the
--    whole of the distinction and it is drawn here deliberately.

alter type app.subscription_status add value if not exists 'suspended';

-- ---------------------------------------------------------------------------
-- Sign-in activity. auth.users exists on Supabase but not on bare Postgres (the test harness), so
-- the table is resolved at runtime. Both readers below go through this one function, so the
-- knowledge of where sign-in times live is written down exactly once.
-- ---------------------------------------------------------------------------
create or replace function app.platform_identity_activity()
returns table (identity_id uuid, last_sign_in_at timestamptz)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if to_regclass('auth.users') is null then
    return;
  end if;
  return query execute $q$ select u.id, u.last_sign_in_at from auth.users u where u.last_sign_in_at is not null $q$;
end;
$$;

create or replace function app.platform_org_activity()
returns table (org_id uuid, last_sign_in_at timestamptz, active_today int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select m.org_id,
           max(a.last_sign_in_at),
           count(*) filter (
             where (a.last_sign_in_at at time zone 'Asia/Riyadh')::date
                 = (now() at time zone 'Asia/Riyadh')::date)::int
      from app.membership m
      join app.platform_identity_activity() a on a.identity_id = m.identity_id
     where m.status = 'active' and m.deleted_at is null
     group by m.org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- operator_extend_trial(org, days)
-- ---------------------------------------------------------------------------
create or replace function app.operator_extend_trial(p_org uuid, p_days int, p_reason text default null)
returns timestamptz
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_status app.subscription_status;
  v_from   timestamptz;
  v_new    timestamptz;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_days is null or p_days <= 0 or p_days > 365 then
    raise exception 'INVALID_DAYS' using errcode = 'raise_exception';
  end if;

  select status, trial_ends_at into v_status, v_from
    from app.org_subscription where org_id = p_org;
  if v_status is null then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_status <> 'trialing' then
    raise exception 'NOT_TRIALING' using errcode = 'raise_exception';
  end if;

  -- From the later of now and the current end: extending a trial that lapsed last month by 14 days
  -- from its old end date would grant a trial that is already over.
  v_new := greatest(coalesce(v_from, now()), now()) + make_interval(days => p_days);
  update app.org_subscription set trial_ends_at = v_new where org_id = p_org;

  perform app.write_audit(p_org, 'platform.trial_extend', 'org_subscription', p_org,
    jsonb_build_object('days', p_days, 'from', v_from, 'to', v_new, 'reason', p_reason));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_tenant_360(org)
-- ---------------------------------------------------------------------------
create or replace function app.platform_tenant_360(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_org  app.organization;
  v_team jsonb;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select * into v_org from app.organization where id = p_org and deleted_at is null;
  if v_org.id is null then
    return null;  -- caller renders notFound(); an exception here would be an error, not an absence
  end if;

  -- The office's own staff: who to call, what they may do, when they were last here.
  select coalesce(jsonb_agg(t order by t->>'role', t->>'full_name'), '[]'::jsonb) into v_team
    from (
      select jsonb_build_object(
               'identity_id', i.id,
               'full_name',   i.full_name,
               'email',       i.email,
               'phone_e164',  i.phone_e164,
               'role',        m.role,
               'status',      m.status,
               'scope_all',   m.scope_all,
               'joined_at',   m.created_at,
               'last_sign_in_at', a.last_sign_in_at) as t
        from app.membership m
        join app.identity i on i.id = m.identity_id
        left join app.platform_identity_activity() a on a.identity_id = m.identity_id
       where m.org_id = p_org and m.deleted_at is null
    ) rows;

  return jsonb_build_object(
    'org', jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'org_type', v_org.org_type, 'created_at', v_org.created_at),
    'subscription', (
      select jsonb_build_object(
               'plan_code', s.plan_code, 'plan_name', pl.name_ar, 'price_halalas', pl.price_halalas,
               'status', s.status, 'trial_ends_at', s.trial_ends_at,
               'current_period_end', s.current_period_end, 'auto_renew', s.auto_renew,
               'notes', s.notes, 'active', app.subscription_active(p_org))
        from app.org_subscription s left join app.plan pl on pl.code = s.plan_code
       where s.org_id = p_org),
    'limits', jsonb_build_object(
      'properties', app.plan_limit(p_org, 'properties'),
      'units',      app.plan_limit(p_org, 'units'),
      'members',    app.plan_limit(p_org, 'members')),
    'usage', jsonb_build_object(
      'properties', app.usage_count(p_org, 'properties'),
      'units',      app.usage_count(p_org, 'units'),
      'members',    app.usage_count(p_org, 'members')),
    -- Counts only. What the office manages, never a row of it (ADR-0006).
    'portfolio', jsonb_build_object(
      'properties',       (select count(*) from app.property where org_id = p_org and deleted_at is null),
      'units',            (select count(*) from app.unit     where org_id = p_org and deleted_at is null),
      'units_rented',     (select count(*) from app.unit     where org_id = p_org and deleted_at is null and current_status = 'rented'),
      'units_vacant',     (select count(*) from app.unit     where org_id = p_org and deleted_at is null and current_status = 'vacant'),
      'contracts',        (select count(*) from app.contract where org_id = p_org and deleted_at is null),
      'contracts_active', (select count(*) from app.contract where org_id = p_org and deleted_at is null and status = 'active'),
      'owners',           (select count(*) from app.owner    where org_id = p_org and deleted_at is null),
      'tenants',          (select count(*) from app.tenant   where org_id = p_org and deleted_at is null)),
    -- What this office paid US. The office's own collections are its business, not ours to display.
    'revenue', jsonb_build_object(
      'paid_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                        where org_id = p_org and status = 'paid'),
      'payments',     (select count(*) from app.subscription_payment where org_id = p_org and status = 'paid'),
      'last_paid_at', (select max(paid_at) from app.subscription_payment where org_id = p_org and status = 'paid'),
      'failed_30d',   (select count(*) from app.subscription_payment
                        where org_id = p_org and status = 'failed' and created_at >= now() - interval '30 days')),
    'payment_method', (
      select jsonb_build_object('brand', brand, 'last4', last4, 'exp_month', exp_month, 'exp_year', exp_year)
        from app.org_payment_method where org_id = p_org and status = 'active' limit 1),
    'team', v_team,
    'activity', coalesce(
      (select jsonb_build_object('last_sign_in_at', last_sign_in_at, 'active_today', active_today)
         from app.platform_org_activity() where org_id = p_org),
      jsonb_build_object('last_sign_in_at', null, 'active_today', 0)),
    'import_batches', (select count(*) from app.import_batch where org_id = p_org),
    'generated_at', now());
end;
$$;

revoke all on function app.platform_identity_activity()            from public;
revoke all on function app.operator_extend_trial(uuid, int, text)  from public;
revoke all on function app.platform_tenant_360(uuid)               from public;
grant execute on function app.platform_identity_activity()         to authenticated, service_role;
grant execute on function app.operator_extend_trial(uuid, int, text) to authenticated, service_role;
grant execute on function app.platform_tenant_360(uuid)            to authenticated, service_role;

-- ================================================================
-- 0051_platform_billing.sql
-- ================================================================
-- 0051_platform_billing.sql
-- Sprint T-3 — the subscription and billing centres.
--
-- The plan catalog becomes editable from the console. 0036 already treated limits and prices as
-- DATA rather than schema ("tuning them needs no migration"), but there was no gated way to change
-- them, so in practice every price change was a migration. operator_upsert_plan closes that with the
-- usual contract: operator-gated, validated, audited. Lowering a limit never touches existing rows —
-- plan ceilings block NEW creation only (Charter ق-هـ) — and past revenue is safe because
-- subscription_event snapshots the price at the time (0048).
--
-- Everything else here is reporting over records we already keep. Three things the brief asked for
-- are NOT built, and no button was invented for them:
--   • Discounts/coupons — there is no discount model at all. Codes, percent-or-amount, expiry and
--     redemption tracking is its own subsystem; half of it would be worse than none.
--   • Platform tax invoices — we record what an office PAID us, we do not ISSUE them an invoice.
--     As a Saudi vendor we owe our customers a ZATCA tax invoice for subscription fees; that is a
--     real gap, and it is a feature, not a report.
--   • Refunds — the status enum has `refunded`, but marking a row refunded without calling the
--     gateway would be a lie told to our own books. Refunded payments are REPORTED here; issuing
--     one needs the Moyasar refund API and a webhook, which this migration deliberately does not fake.

-- ---------------------------------------------------------------------------
-- operator_upsert_plan — create or re-tune a plan. NULL limit = unlimited, which is why the limit
-- arguments cannot use NULL to mean "leave unchanged": the caller always sends the full row.
-- ---------------------------------------------------------------------------
create or replace function app.operator_upsert_plan(
  p_code           text,
  p_name_ar        text,
  p_price_halalas  bigint,
  p_max_properties int  default null,
  p_max_units      int  default null,
  p_max_members    int  default null,
  p_is_public      boolean default true,
  p_sort           int  default 0
) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_before app.plan;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_code !~ '^[a-z][a-z0-9_]{1,29}$' then
    raise exception 'INVALID_PLAN_CODE' using errcode = 'raise_exception';
  end if;
  if coalesce(nullif(btrim(p_name_ar), ''), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'raise_exception';
  end if;
  if p_price_halalas is null or p_price_halalas < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'raise_exception';
  end if;
  if coalesce(p_max_properties, 0) < 0 or coalesce(p_max_units, 0) < 0 or coalesce(p_max_members, 0) < 0 then
    raise exception 'INVALID_LIMIT' using errcode = 'raise_exception';
  end if;

  select * into v_before from app.plan where code = p_code;

  insert into app.plan (code, name_ar, price_halalas, max_properties, max_units, max_members, is_public, sort)
  values (p_code, btrim(p_name_ar), p_price_halalas, p_max_properties, p_max_units, p_max_members,
          coalesce(p_is_public, true), coalesce(p_sort, 0))
  on conflict (code) do update set
    name_ar        = excluded.name_ar,
    price_halalas  = excluded.price_halalas,
    max_properties = excluded.max_properties,
    max_units      = excluded.max_units,
    max_members    = excluded.max_members,
    is_public      = excluded.is_public,
    sort           = excluded.sort,
    updated_at     = now();

  -- A platform-wide change: no org owns it, so the audit row carries a null org (write_audit then
  -- records the identity without a membership, which is the marker of a platform action).
  perform app.write_audit(null, 'platform.plan_upsert', 'plan', null, jsonb_build_object(
    'code', p_code,
    'before', case when v_before.code is null then null else jsonb_build_object(
      'name_ar', v_before.name_ar, 'price_halalas', v_before.price_halalas,
      'max_properties', v_before.max_properties, 'max_units', v_before.max_units,
      'max_members', v_before.max_members, 'is_public', v_before.is_public) end,
    'after', jsonb_build_object(
      'name_ar', btrim(p_name_ar), 'price_halalas', p_price_halalas,
      'max_properties', p_max_properties, 'max_units', p_max_units,
      'max_members', p_max_members, 'is_public', coalesce(p_is_public, true))));
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_list_payments — every subscription payment on the platform, paged and filtered, with the
-- office it belongs to. Same paging contract as platform_list_orgs: total_count is the size of the
-- FILTERED set, repeated on each row.
-- ---------------------------------------------------------------------------
create or replace function app.platform_list_payments(
  p_search text default null,
  p_status app.subscription_payment_status default null,
  p_limit  int default 20,
  p_offset int default 0
)
returns table (
  id uuid, org_id uuid, org_name text, plan_code text,
  amount_halalas bigint, currency text, gateway text, gateway_payment_id text,
  status app.subscription_payment_status,
  period_start timestamptz, period_end timestamptz,
  created_at timestamptz, paid_at timestamptz,
  failure_reason text, total_count bigint
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with matched as (
      select sp.*, o.name as org_name
        from app.subscription_payment sp
        join app.organization o on o.id = sp.org_id
       where (p_status is null or sp.status = p_status)
         and (p_search is null
              or o.name ilike '%' || p_search || '%'
              or sp.gateway_payment_id ilike '%' || p_search || '%')
    )
    select m.id, m.org_id, m.org_name, m.plan_code,
           m.amount_halalas, m.currency, m.gateway, m.gateway_payment_id,
           m.status, m.period_start, m.period_end, m.created_at, m.paid_at,
           -- The gateway owns this shape; read the usual places and say nothing when none of them
           -- carry a message rather than inventing a reason.
           coalesce(m.raw->>'message', m.raw#>>'{source,message}', m.raw->>'error'),
           count(*) over ()
      from matched m
     order by m.created_at desc
     limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_billing_health(days) — what the gateway has actually been doing for us. This is derived
-- from our own records; a live "is Moyasar up" probe would need their API and is not claimed here.
-- ---------------------------------------------------------------------------
create or replace function app.platform_billing_health(p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_paid   int;
  v_failed int;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select count(*) filter (where status = 'paid'), count(*) filter (where status = 'failed')
    into v_paid, v_failed
    from app.subscription_payment where created_at >= v_since;

  return jsonb_build_object(
    'window_days', greatest(coalesce(p_days, 30), 1),
    'paid_count', v_paid,
    'failed_count', v_failed,
    -- Undefined, not 100%, when nothing has been attempted: a rate over zero attempts is not a fact.
    'success_rate', case when (v_paid + v_failed) > 0
                         then round(v_paid::numeric / (v_paid + v_failed), 4) end,
    'paid_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                      where status = 'paid' and created_at >= v_since),
    'refunded_count', (select count(*) from app.subscription_payment
                        where status = 'refunded' and created_at >= v_since),
    'refunded_halalas', (select coalesce(sum(amount_halalas), 0) from app.subscription_payment
                          where status = 'refunded' and created_at >= v_since),
    'initiated_stale', (select count(*) from app.subscription_payment
                         where status = 'initiated' and created_at < now() - interval '24 hours'),
    'last_paid_at', (select max(paid_at) from app.subscription_payment where status = 'paid'),
    'last_failed_at', (select max(created_at) from app.subscription_payment where status = 'failed'),
    'failure_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc), '[]'::jsonb)
        from (
          select coalesce(raw->>'message', raw#>>'{source,message}', raw->>'error') as reason,
                 count(*)::int as n
            from app.subscription_payment
           where status = 'failed' and created_at >= v_since
           group by 1 limit 8
        ) f),
    'generated_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_subscription_center() — the lifecycle view: who is on trial, what renews soon, who is
-- armed for auto-renew and who is not, and who has been stopped.
-- ---------------------------------------------------------------------------
create or replace function app.platform_subscription_center()
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return jsonb_build_object(
    'trials', (
      select jsonb_build_object(
        'total',       count(*),
        'expiring_7d', count(*) filter (where trial_ends_at between now() and now() + interval '7 days'),
        'expiring_30d',count(*) filter (where trial_ends_at between now() and now() + interval '30 days'),
        -- Still flagged `trialing` but the date has passed: entitlement is already off and nobody
        -- has decided what happens next. These are the ones a human needs to look at.
        'lapsed',      count(*) filter (where trial_ends_at is not null and trial_ends_at < now()))
      from app.org_subscription where status = 'trialing'),
    'renewals', (
      select jsonb_build_object(
        'due_7d',  count(*) filter (where current_period_end between now() and now() + interval '7 days'),
        'due_30d', count(*) filter (where current_period_end between now() and now() + interval '30 days'),
        'auto_renew_on',  count(*) filter (where auto_renew),
        'auto_renew_off', count(*) filter (where not auto_renew))
      from app.org_subscription where status = 'active'),
    -- An active subscription with no saved card cannot renew itself; it will lapse silently unless
    -- someone calls. That is the single most actionable list in this payload.
    'active_without_card', (
      select count(*) from app.org_subscription s
       where s.status = 'active'
         and not exists (select 1 from app.org_payment_method m
                          where m.org_id = s.org_id and m.status = 'active')),
    'stopped', jsonb_build_object(
      'suspended',    (select count(*) from app.org_subscription where status = 'suspended'),
      'past_due',     (select count(*) from app.org_subscription where status = 'past_due'),
      'canceled',     (select count(*) from app.org_subscription where status = 'canceled'),
      'canceled_30d', (select count(distinct org_id) from app.subscription_event
                        where kind = 'status_changed' and to_status = 'canceled'
                          and created_at >= now() - interval '30 days')),
    'generated_at', now());
end;
$$;

revoke all on function app.operator_upsert_plan(text, text, bigint, int, int, int, boolean, int) from public;
revoke all on function app.platform_list_payments(text, app.subscription_payment_status, int, int) from public;
revoke all on function app.platform_billing_health(int)      from public;
revoke all on function app.platform_subscription_center()    from public;
grant execute on function app.operator_upsert_plan(text, text, bigint, int, int, int, boolean, int) to authenticated, service_role;
grant execute on function app.platform_list_payments(text, app.subscription_payment_status, int, int) to authenticated, service_role;
grant execute on function app.platform_billing_health(int)   to authenticated, service_role;
grant execute on function app.platform_subscription_center() to authenticated, service_role;

-- ================================================================
-- 0052_platform_health_audit.sql
-- ================================================================
-- 0052_platform_health_audit.sql
-- Sprint T-4 — platform health, system alerts, and the audit centre.
--
-- One instrumentation gap had to be closed first: THE CRON JOBS LEFT NO TRACE. The notification
-- drainer and the renewal engine ran on Vercel Cron and reported nothing to us, so "did the mail
-- queue drain last night" was unanswerable — and a cron that silently stopped firing looked exactly
-- like a cron with nothing to do. app.cron_run records every run. That is the difference between a
-- health page that reports and one that guesses.
--
-- Everything else here reads records we already keep. What lives OUTSIDE this database — Supabase
-- storage, edge functions, the Vercel runtime, the payment provider's own uptime — is reported as
-- unmeasured, with a link out. A green dot we did not observe is worse than no dot.
--
-- AUDIT AND THE ISOLATION LINE (ADR-0006). Audit rows carry two different kinds of thing: the
-- METADATA of an action (who, what, which office, when) and its `detail` payload, which for office
-- actions can contain the office's own figures. The metadata is not tenant data — it is the shape of
-- activity, the same category as a count. The payload can be. So the platform audit reader returns
-- every row's metadata and returns `detail` ONLY for `platform.*` actions: the console can see that
-- an office activated twelve contracts last week without reading one of them.

-- ---------------------------------------------------------------------------
-- cron_run — one row per scheduled run. Platform-only (RLS on, no policy).
-- ---------------------------------------------------------------------------
create table if not exists app.cron_run (
  id          bigint generated always as identity primary key,
  job         text not null,
  ok          boolean not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  duration_ms int,
  detail      jsonb not null default '{}'::jsonb,
  error       text
);

create index if not exists cron_run_job_idx on app.cron_run (job, finished_at desc);

alter table app.cron_run enable row level security;  -- no policy → DEFINER-only, like every platform table

-- Written by the cron routes, which run as service_role. Not granted to authenticated: a signed-in
-- user must never be able to forge a "the job ran fine" record.
create or replace function app.record_cron_run(
  p_job text, p_ok boolean, p_started_at timestamptz default null,
  p_detail jsonb default '{}'::jsonb, p_error text default null
) returns void
language sql security definer set search_path = app, pg_temp as $$
  insert into app.cron_run (job, ok, started_at, finished_at, duration_ms, detail, error)
  values (p_job, p_ok, coalesce(p_started_at, now()), now(),
          case when p_started_at is null then null
               else greatest(0, (extract(epoch from (now() - p_started_at)) * 1000)::int) end,
          coalesce(p_detail, '{}'::jsonb), p_error);
$$;

-- ---------------------------------------------------------------------------
-- platform_health() — the subsystems we can actually observe from in here.
-- ---------------------------------------------------------------------------
create or replace function app.platform_health()
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return jsonb_build_object(
    'email_queue', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'failed',  count(*) filter (where status = 'failed'),
        'sent_24h',count(*) filter (where status = 'sent' and sent_at >= now() - interval '24 hours'),
        -- Due to be retried and still sitting there: the drainer is not keeping up, or not running.
        'overdue', count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '1 hour'),
        'oldest_pending_at', min(created_at) filter (where status = 'pending'))
      from app.notification_delivery),
    'notifications', (
      select jsonb_build_object(
        'total_24h', count(*) filter (where created_at >= now() - interval '24 hours'),
        'unread',    count(*) filter (where read_at is null))
      from app.notification),
    'cron', (
      select coalesce(jsonb_agg(j order by j->>'job'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'job', r.job,
                 'last_run_at', r.finished_at,
                 'ok', r.ok,
                 'duration_ms', r.duration_ms,
                 'error', r.error,
                 'failures_24h', (select count(*) from app.cron_run f
                                   where f.job = r.job and not f.ok and f.finished_at >= now() - interval '24 hours')
               ) as j
          from app.cron_run r
          join (select job, max(finished_at) as m from app.cron_run group by job) last
            on last.job = r.job and last.m = r.finished_at
      ) rows),
    'payments', (
      select jsonb_build_object(
        'paid_24h',   count(*) filter (where status = 'paid'   and created_at >= now() - interval '24 hours'),
        'failed_24h', count(*) filter (where status = 'failed' and created_at >= now() - interval '24 hours'),
        -- An intent that never heard back from the gateway. One or two is noise; a pile means the
        -- webhook is not arriving.
        'awaiting_webhook', count(*) filter (where status = 'initiated' and created_at < now() - interval '1 hour'),
        'last_webhook_at', max(paid_at) filter (where status = 'paid'))
      from app.subscription_payment),
    'imports', (
      select jsonb_build_object(
        'batches_24h', count(*) filter (where created_at >= now() - interval '24 hours'),
        'stuck', count(*) filter (where status = 'validated' and created_at < now() - interval '7 days'))
      from app.import_batch),
    'generated_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_alerts() — one prioritized list rather than a wall of disconnected cards. `kind` is a
-- stable key the UI maps to a destination; SQL stays free of routes.
-- Severity: 1 = act now, 2 = look today, 3 = worth knowing.
-- ---------------------------------------------------------------------------
create or replace function app.platform_alerts()
returns table (kind text, severity int, count int, detail jsonb)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
  with a as (
    -- A cron that failed is the alert that hides every other alert: the queues it drains stop
    -- moving and nothing else on this page can be trusted to be current.
    select 'cron_failed'::text as kind, 1 as severity,
           (select count(*)::int from app.cron_run where not ok and finished_at >= now() - interval '24 hours') as count,
           (select coalesce(jsonb_agg(distinct job), '[]'::jsonb) from app.cron_run
             where not ok and finished_at >= now() - interval '24 hours') as detail
    union all
    select 'email_failed', 1,
           (select count(*)::int from app.notification_delivery where status = 'failed'),
           '{}'::jsonb
    union all
    select 'email_overdue', 2,
           (select count(*)::int from app.notification_delivery
             where status = 'pending' and next_attempt_at < now() - interval '1 hour'),
           '{}'::jsonb
    union all
    select 'payment_failed', 1,
           (select count(*)::int from app.subscription_payment
             where status = 'failed' and created_at >= now() - interval '7 days'),
           '{}'::jsonb
    union all
    select 'payment_awaiting_webhook', 2,
           (select count(*)::int from app.subscription_payment
             where status = 'initiated' and created_at < now() - interval '1 hour'),
           '{}'::jsonb
    union all
    select 'subscription_past_due', 1,
           (select count(*)::int from app.org_subscription where status = 'past_due'),
           '{}'::jsonb
    union all
    select 'trial_lapsed', 2,
           (select count(*)::int from app.org_subscription
             where status = 'trialing' and trial_ends_at is not null and trial_ends_at < now()),
           '{}'::jsonb
    union all
    select 'renewal_without_card', 2,
           (select count(*)::int from app.org_subscription s
             where s.status = 'active'
               and s.current_period_end between now() and now() + interval '30 days'
               and not exists (select 1 from app.org_payment_method m
                                where m.org_id = s.org_id and m.status = 'active')),
           '{}'::jsonb
    union all
    -- At or over a plan ceiling. Nothing broke — the office simply cannot add anything, which is a
    -- sales conversation, not an incident.
    select 'limit_reached', 3,
           (select count(*)::int from app.org_subscription s
             where (app.plan_limit(s.org_id, 'properties') is not null
                    and app.usage_count(s.org_id, 'properties') >= app.plan_limit(s.org_id, 'properties'))
                or (app.plan_limit(s.org_id, 'units') is not null
                    and app.usage_count(s.org_id, 'units') >= app.plan_limit(s.org_id, 'units'))
                or (app.plan_limit(s.org_id, 'members') is not null
                    and app.usage_count(s.org_id, 'members') >= app.plan_limit(s.org_id, 'members'))),
           '{}'::jsonb
  )
  select a.kind, a.severity, a.count, a.detail from a where a.count > 0 order by a.severity, a.count desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_list_audit(...) — the audit centre. `detail` is returned for platform actions only; for
-- office actions the row still names who did what to which office and when.
-- ---------------------------------------------------------------------------
create or replace function app.platform_list_audit(
  p_org    uuid default null,
  p_action text default null,
  p_search text default null,
  p_platform_only boolean default false,
  p_limit  int default 30,
  p_offset int default 0
)
returns table (
  id bigint, created_at timestamptz, action text, org_id uuid, org_name text,
  identity_id uuid, actor_name text, is_platform_action boolean,
  entity_type text, entity_id uuid, detail jsonb, total_count bigint
)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    with matched as (
      select l.*, o.name as org_name, i.full_name as actor_name,
             (l.action like 'platform.%') as is_platform
        from app.audit_log l
        left join app.organization o on o.id = l.org_id
        left join app.identity i on i.id = l.identity_id
       where (p_org is null or l.org_id = p_org)
         and (p_action is null or l.action = p_action)
         and (not p_platform_only or l.action like 'platform.%')
         and (p_search is null
              or l.action ilike '%' || p_search || '%'
              or o.name   ilike '%' || p_search || '%'
              or i.full_name ilike '%' || p_search || '%')
    )
    select m.id, m.created_at, m.action, m.org_id, m.org_name,
           m.identity_id, m.actor_name, m.is_platform,
           m.entity_type, m.entity_id,
           -- The payload of an office action can hold that office's own figures; the platform sees
           -- that the action happened, not what was inside it (ADR-0006).
           case when m.is_platform then m.detail else null end,
           count(*) over ()
      from matched m
     order by m.id desc
     limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

-- platform_audit_actions() — the distinct action names, for the filter. Cheap on a small log and
-- honest about what actually exists rather than a hardcoded list that drifts.
create or replace function app.platform_audit_actions()
returns table (action text, count int)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select l.action, count(*)::int from app.audit_log l group by l.action order by 2 desc, 1;
end;
$$;

-- 0001 sets `alter default privileges in schema app grant execute on functions to anon,
-- authenticated, service_role`, so a new function is granted to those roles the moment it is
-- created and `revoke ... from public` does NOT take that away. Every gated function relies on its
-- internal FORBIDDEN check and is unaffected; a function with NO internal gate, like this one, must
-- name the roles explicitly or any signed-in user can call it. See 0053.
revoke all on function app.record_cron_run(text, boolean, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function app.platform_health()          from public;
revoke all on function app.platform_alerts()          from public;
revoke all on function app.platform_list_audit(uuid, text, text, boolean, int, int) from public;
revoke all on function app.platform_audit_actions()   from public;
grant execute on function app.record_cron_run(text, boolean, timestamptz, jsonb, text) to service_role;
grant execute on function app.platform_health()       to authenticated, service_role;
grant execute on function app.platform_alerts()       to authenticated, service_role;
grant execute on function app.platform_list_audit(uuid, text, text, boolean, int, int) to authenticated, service_role;
grant execute on function app.platform_audit_actions() to authenticated, service_role;

-- ================================================================
-- 0053_service_role_only_grants.sql
-- ================================================================
-- 0053_service_role_only_grants.sql
-- SECURITY FIX. Found while writing the T-4 health tests, and older than that sprint.
--
-- 0001 declares:
--     alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;
--
-- so EVERY function in app is granted EXECUTE to anon and authenticated the moment it is created.
-- `revoke all on function ... from public` — which is what the webhook-only and cron-only functions
-- did — removes the implicit PUBLIC grant but leaves those two EXPLICIT role grants untouched. The
-- functions were therefore callable by any signed-in user.
--
-- For the gated functions this changed nothing: `is_platform_operator()`, `has_org_access()` and the
-- rest are checked INSIDE the function, and ADR-0006 says exactly that — the grant is not what
-- authorizes. But the service-role-only functions have no internal gate at all. The grant was the
-- whole defence, and it was not there.
--
-- The worst of them: app.apply_subscription_payment(intent, gateway_id, raw) marks a subscription
-- paid and rolls the period forward. A signed-in user who could read their own payment intent id —
-- it is in their own row — could call it and extend their subscription without paying. Confirmed
-- against PG17: the call executed and returned PAYMENT_INTENT_NOT_FOUND for a bogus id rather than
-- being refused. Same shape for the dunning, email-outbox, renewal-claim and card-token functions.
--
-- The default privilege declaration STAYS: the whole platform and app surface depends on
-- `authenticated` being able to reach gated functions. The rule this migration establishes is the
-- other half of it —
--
--     A FUNCTION WITH NO INTERNAL AUTHORIZATION CHECK MUST REVOKE FROM anon AND authenticated
--     EXPLICITLY. Revoking from PUBLIC is not enough in this schema.
--
-- Nothing about behaviour changes for the legitimate callers: every one of these is invoked by a
-- server route holding the service_role key, or from inside another SECURITY DEFINER function
-- (which executes as the owner and does not consult the caller's grants).

-- Read helpers: leak another org's counts to any signed-in caller. Their real callers are the
-- SECURITY DEFINER enforcement trigger and the summary/platform readers, so this is invisible to them.
revoke all on function app.subscription_active(uuid)  from public, anon, authenticated;
revoke all on function app.plan_limit(uuid, text)     from public, anon, authenticated;
revoke all on function app.usage_count(uuid, text)    from public, anon, authenticated;

-- Email outbox: leasing, and declaring a message sent that was never sent.
revoke all on function app.claim_email_deliveries(int)                   from public, anon, authenticated;
revoke all on function app.mark_email_delivery_sent(uuid, text, jsonb)   from public, anon, authenticated;
revoke all on function app.mark_email_delivery_failed(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function app.enqueue_notification_email(uuid)              from public, anon, authenticated;

-- Money. apply_subscription_payment is the one that mattered.
revoke all on function app.apply_subscription_payment(uuid, text, jsonb)     from public, anon, authenticated;
revoke all on function app.mark_subscription_payment_failed(uuid, jsonb)     from public, anon, authenticated;
revoke all on function app.save_payment_method(uuid, text, text, text, int, int) from public, anon, authenticated;
revoke all on function app.claim_due_renewals(int)                          from public, anon, authenticated;
revoke all on function app.record_dunning_failure(uuid, jsonb)              from public, anon, authenticated;

-- Re-assert the intended grant so re-running this file leaves the surface exactly as designed.
grant execute on function app.subscription_active(uuid)  to service_role;
grant execute on function app.plan_limit(uuid, text)     to service_role;
grant execute on function app.usage_count(uuid, text)    to service_role;
grant execute on function app.claim_email_deliveries(int)                   to service_role;
grant execute on function app.mark_email_delivery_sent(uuid, text, jsonb)   to service_role;
grant execute on function app.mark_email_delivery_failed(uuid, text, jsonb) to service_role;
grant execute on function app.enqueue_notification_email(uuid)              to service_role;
grant execute on function app.apply_subscription_payment(uuid, text, jsonb)     to service_role;
grant execute on function app.mark_subscription_payment_failed(uuid, jsonb)     to service_role;
grant execute on function app.save_payment_method(uuid, text, text, text, int, int) to service_role;
grant execute on function app.claim_due_renewals(int)                          to service_role;
grant execute on function app.record_dunning_failure(uuid, jsonb)              to service_role;

-- ================================================================
-- 0054_platform_settings_flags_broadcast.sql
-- ================================================================
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

-- ================================================================
-- 0055_platform_fixes.sql
-- ================================================================
-- 0055_platform_fixes.sql
-- Two fixes from the clean-code-guard review of the platform console.
--
-- 1. platform_broadcast read an EXPLICITLY EMPTY audience as "everyone". The org list was collected
--    with array_agg over jsonb_array_elements, and array_agg over zero rows returns NULL — the same
--    NULL that the filter used to mean "no restriction". So {"orgs": []}, which says send to nobody,
--    reached every office on the platform. Absence and emptiness cannot be told apart by the value
--    alone, so presence of the key is now tracked separately.
--
--    Writing the test for that exposed a second fault in the same key: the ids were read with
--    `value::text::uuid`, and ::text on a jsonb string keeps its quotes, so every NON-empty list
--    raised. Between the two, {"orgs": …} had no correct input: empty reached everyone, non-empty
--    errored. Neither is reachable from the console today (the composer sends only status and plan)
--    — which is exactly why it needed fixing now, before the first caller finds the worst possible
--    failure mode in the least reversible action in the product.
--
-- 2. trial_days accepted 0. A zero-day trial provisions an office that is locked out the moment it
--    is created — subscription_active() sees an already-expired trial. The floor is 1.

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
  -- Floor of 1: a zero-day trial creates an office that is locked out on arrival.
  if p_key = 'trial_days' and (jsonb_typeof(p_value) <> 'number'
       or (p_value)::text::int < 1 or (p_value)::text::int > 365) then
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

create or replace function app.platform_broadcast(
  p_title text,
  p_body text default null,
  p_audience jsonb default '{}'::jsonb,
  p_channel text default 'in_app',
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_status   text := p_audience->>'status';
  v_plan     text := p_audience->>'plan';
  -- Presence of the key, not the value: array_agg over an empty array yields NULL, which is
  -- indistinguishable from "the caller never asked to restrict by org".
  v_by_orgs  boolean := coalesce(p_audience ? 'orgs', false);
  v_orgs     uuid[] := '{}'::uuid[];
  v_ids      uuid[];
  v_emails   int := 0;
  v_id       uuid;
  v_note     uuid;
  v_bid      uuid;
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

  if v_by_orgs then
    -- `value::text` on a jsonb string keeps its quotes ("…"), which is not a uuid; #>> '{}' unwraps
    -- the scalar. The original cast raised on every non-empty list, so between that and the empty
    -- list reaching everyone, this key had no correct input at all.
    select coalesce(array_agg((value #>> '{}')::uuid), '{}'::uuid[]) into v_orgs
      from jsonb_array_elements(p_audience->'orgs');
  end if;

  select array_agg(o.id) into v_ids
    from app.organization o
    left join app.org_subscription s on s.org_id = o.id
   where o.deleted_at is null
     and (v_status is null or s.status::text = v_status)
     and (v_plan   is null or s.plan_code = v_plan)
     and (not v_by_orgs or o.id = any(v_orgs));

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

revoke all on function app.operator_set_setting(text, jsonb)                   from public;
revoke all on function app.platform_broadcast(text, text, jsonb, text, boolean) from public;
grant execute on function app.operator_set_setting(text, jsonb)                to authenticated, service_role;
grant execute on function app.platform_broadcast(text, text, jsonb, text, boolean) to authenticated, service_role;

-- ================================================================
-- 0056_alerts_limit_scan.sql
-- ================================================================
-- 0056_alerts_limit_scan.sql
-- Performance fix from the console review. Same answer, far less work.
--
-- The `limit_reached` alert asked, per subscription, whether the office had hit any of its three
-- plan ceilings — through app.plan_limit and app.usage_count, each a SECURITY DEFINER call wrapping
-- its own query. Written as a boolean OR of three pairs, that is SIX plan_limit calls and THREE
-- usage_count calls for EVERY subscription on the platform, and each usage_count is a count(*) over
-- property, unit or membership. At a thousand offices that is roughly nine thousand aggregate
-- queries — and not on some rarely-opened report, but on the executive dashboard, because the alert
-- banner at the top of it calls platform_alerts on every load.
--
-- This is the same shape as the problem T-0 fixed in operator_list_orgs (a per-row count on an
-- unbounded set), reintroduced from another direction. The counts are now three grouped aggregates
-- computed once and joined, so the cost stops depending on the number of offices in that way.
--
-- Behaviour is identical, deliberately including one thing that is arguably wrong: soft-deleted
-- organizations are still counted, exactly as before. platform_kpis excludes them, so the two
-- disagree — but a refactor is not the place to change an answer. Left as-is and flagged.

create or replace function app.platform_alerts()
returns table (kind text, severity int, count int, detail jsonb)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
  with usage as (
    -- One pass per resource for the whole platform, instead of one call per office per resource.
    select s.org_id,
           pl.max_properties, pl.max_units, pl.max_members,
           coalesce(p.n, 0) as properties, coalesce(u.n, 0) as units, coalesce(m.n, 0) as members
      from app.org_subscription s
      join app.plan pl on pl.code = s.plan_code
      left join (select org_id, count(*) n from app.property   where deleted_at is null group by org_id) p on p.org_id = s.org_id
      left join (select org_id, count(*) n from app.unit       where deleted_at is null group by org_id) u on u.org_id = s.org_id
      left join (select org_id, count(*) n from app.membership
                  where status = 'active' and deleted_at is null group by org_id) m on m.org_id = s.org_id
  ),
  a as (
    -- A cron that failed is the alert that hides every other alert: the queues it drains stop
    -- moving and nothing else on this page can be trusted to be current.
    select 'cron_failed'::text as kind, 1 as severity,
           (select count(*)::int from app.cron_run where not ok and finished_at >= now() - interval '24 hours') as count,
           (select coalesce(jsonb_agg(distinct job), '[]'::jsonb) from app.cron_run
             where not ok and finished_at >= now() - interval '24 hours') as detail
    union all
    select 'email_failed', 1,
           (select count(*)::int from app.notification_delivery where status = 'failed'),
           '{}'::jsonb
    union all
    select 'email_overdue', 2,
           (select count(*)::int from app.notification_delivery
             where status = 'pending' and next_attempt_at < now() - interval '1 hour'),
           '{}'::jsonb
    union all
    select 'payment_failed', 1,
           (select count(*)::int from app.subscription_payment
             where status = 'failed' and created_at >= now() - interval '7 days'),
           '{}'::jsonb
    union all
    select 'payment_awaiting_webhook', 2,
           (select count(*)::int from app.subscription_payment
             where status = 'initiated' and created_at < now() - interval '1 hour'),
           '{}'::jsonb
    union all
    select 'subscription_past_due', 1,
           (select count(*)::int from app.org_subscription where status = 'past_due'),
           '{}'::jsonb
    union all
    select 'trial_lapsed', 2,
           (select count(*)::int from app.org_subscription
             where status = 'trialing' and trial_ends_at is not null and trial_ends_at < now()),
           '{}'::jsonb
    union all
    select 'renewal_without_card', 2,
           (select count(*)::int from app.org_subscription s
             where s.status = 'active'
               and s.current_period_end between now() and now() + interval '30 days'
               and not exists (select 1 from app.org_payment_method m
                                where m.org_id = s.org_id and m.status = 'active')),
           '{}'::jsonb
    union all
    -- At or over a plan ceiling. Nothing broke — the office simply cannot add anything, which is a
    -- sales conversation, not an incident.
    select 'limit_reached', 3,
           (select count(*)::int from usage
             where (max_properties is not null and properties >= max_properties)
                or (max_units      is not null and units      >= max_units)
                or (max_members    is not null and members    >= max_members)),
           '{}'::jsonb
  )
  select a.kind, a.severity, a.count, a.detail from a where a.count > 0 order by a.severity, a.count desc;
end;
$$;

revoke all on function app.platform_alerts() from public;
grant execute on function app.platform_alerts() to authenticated, service_role;

-- ================================================================
-- 0057_tenant_identity.sql
-- ================================================================
-- 0057_tenant_identity.sql
-- Sprint M-1: one primary identifier per tenant type, a required establishment representative,
-- and a trade-name (brand) catalogue.
--
-- The rule being encoded (agreed 2 Aug 2026):
--   * individual                    → national id / iqama / passport (exactly one) is REQUIRED
--   * sole_establishment | company  → unified number (700) is REQUIRED, and the person block
--                                     becomes the establishment REPRESENTATIVE (name + id + phone),
--                                     also required.
--   * either case may be waived by recording an explicit id_exempt_reason (government bodies,
--     embassies, foreign companies with no 700 number). An empty field is never a valid answer.
--
-- Design decisions and why:
--   1. entity_type moves onto app.party. It cannot live only on app.tenant: createTenant inserts the
--      party BEFORE the tenant row, so a rule that reads the type at party-insert time has nothing to
--      read, and a CHECK constraint cannot span two tables. tenant.tenant_type/tenant_kind stay as
--      mirrors for backward compatibility and are now maintained by trigger, not by the app layer.
--   2. primary_id is a GENERATED column over the existing identifier columns, so there is no second
--      source of truth and no data migration. Search and de-duplication both read this one column.
--   3. Requirements are enforced by TRIGGER, not by CHECK. A NOT VALID CHECK still fires on UPDATE of
--      a pre-existing row, which would block someone from fixing a phone number on a legacy tenant.
--      The agreed behaviour is: block new incomplete records, keep legacy records editable, and flag
--      them with a "بيانات ناقصة" badge. Only a trigger can compare OLD to NEW and express that.
--   4. Uniqueness is likewise a trigger check rather than a unique index: rows imported before this
--      migration may already collide, and a failing CREATE UNIQUE INDEX would abort the whole apply.
--      Legacy collisions are tolerated; new ones are refused. Promote to a real unique index once
--      a duplicate scan over (org_id, primary_id) comes back empty.

-- ---------------------------------------------------------------------------
-- 1. New columns.
-- ---------------------------------------------------------------------------
alter table app.party add column if not exists entity_type text
  check (entity_type in ('individual', 'sole_establishment', 'company'));
alter table app.party add column if not exists passport_no      text;  -- جواز السفر (غير السعوديين)
alter table app.party add column if not exists id_exempt_reason text;  -- سبب الإعفاء من المعرّف
alter table app.party add column if not exists vat_registered   boolean;  -- null = لم يُسأل بعد
alter table app.party add column if not exists rep_name         text;
alter table app.party add column if not exists rep_id_number    text;
alter table app.party add column if not exists rep_capacity     text;
alter table app.party add column if not exists rep_phone_e164   text;
alter table app.party add column if not exists rep_phone_raw    text;

-- At most one personal identifier, so primary_id is never ambiguous.
alter table app.party drop constraint if exists party_one_personal_id;
alter table app.party add constraint party_one_personal_id check (
  num_nonnulls(nullif(national_id, ''), nullif(iqama_id, ''), nullif(passport_no, '')) <= 1
) not valid;

-- New column, so no legacy values can violate it — safe to add as a validated constraint.
alter table app.party drop constraint if exists party_rep_phone_fmt;
alter table app.party add constraint party_rep_phone_fmt
  check (rep_phone_e164 is null or rep_phone_e164 ~ '^\+9665[0-9]{8}$');

-- Existing tenants keep their meaning: tenant.tenant_type was the source until now.
update app.party p
   set entity_type = t.tenant_type
  from app.tenant t
 where t.party_id = p.id and p.entity_type is null;

-- ---------------------------------------------------------------------------
-- 2. The single primary identifier + the completeness flag, both derived.
-- Establishment first: a sole establishment stores its owner's id under rep_id_number, so the 700
-- number is what identifies the *tenant*.
-- ---------------------------------------------------------------------------
alter table app.party add column if not exists primary_id text
  generated always as (
    coalesce(nullif(unified_number, ''), nullif(national_id, ''),
             nullif(iqama_id, ''),       nullif(passport_no, ''))
  ) stored;

-- Scoped by role, not by entity_type: a tenant party with no type recorded must still comply,
-- otherwise leaving the type blank would silently opt out of the whole rule.
alter table app.party add column if not exists identity_complete boolean
  generated always as (
    case
      when not ('tenant' = any(roles))                then true
      when coalesce(id_exempt_reason, '') <> ''       then true
      when coalesce(entity_type, 'individual') = 'individual' then
        coalesce(nullif(national_id, ''), nullif(iqama_id, ''), nullif(passport_no, '')) is not null
      else
        nullif(unified_number, '') is not null
        and nullif(rep_name, '')       is not null
        and nullif(rep_id_number, '')  is not null
        and nullif(rep_phone_e164, '') is not null
    end
  ) stored;

create index if not exists party_primary_id_idx on app.party (org_id, primary_id)
  where primary_id is not null and deleted_at is null;
-- Answers "which establishments does this person represent?" without a separate person table.
create index if not exists party_rep_id_idx on app.party (org_id, rep_id_number)
  where rep_id_number is not null and deleted_at is null;
-- Backs the "بيانات ناقصة" filter on the tenants list.
create index if not exists party_incomplete_idx on app.party (org_id)
  where not identity_complete and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Normalisation + format validation (BEFORE).
-- Identifiers are stored digits-only so that search matches whether the user typed spaces or not.
-- ---------------------------------------------------------------------------
create or replace function app.digits_only(p_value text) returns text
language sql immutable as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), '');
$$;

-- The accepted shape of every KSA identifier, in one place. The importer (0058) validates the same
-- values against these patterns, and a format that lives in two files drifts in one of them.
create or replace function app.id_pattern(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'national' then '^1[0-9]{9}$'
    when 'iqama'    then '^2[0-9]{9}$'
    when 'passport' then '^[A-Z0-9]{3,20}$'
    when 'unified'  then '^7[0-9]{9}$'
    when 'cr'       then '^[0-9]{10}$'
    when 'vat'      then '^3[0-9]{13}3$'
    when 'rep'      then '^[12][0-9]{9}$'
  end;
$$;

create or replace function app.assert_id_format(p_code text, p_value text, p_pattern text)
returns void language plpgsql immutable as $$
begin
  if p_value is not null and p_value !~ p_pattern then
    raise exception '%: %', p_code, p_value using errcode = 'check_violation';
  end if;
end;
$$;

-- Only values that are new or actually changed are validated, so a legacy row carrying a malformed
-- identifier can still have its phone or name corrected.
create or replace function app.assert_party_id_formats(p_new app.party, p_old app.party)
returns void language plpgsql as $$
declare fresh boolean := p_old.id is null;
begin
  if fresh or p_new.national_id is distinct from p_old.national_id then
    perform app.assert_id_format('INVALID_NATIONAL_ID', p_new.national_id, app.id_pattern('national'));
  end if;
  if fresh or p_new.iqama_id is distinct from p_old.iqama_id then
    perform app.assert_id_format('INVALID_IQAMA_ID', p_new.iqama_id, app.id_pattern('iqama'));
  end if;
  if fresh or p_new.passport_no is distinct from p_old.passport_no then
    perform app.assert_id_format('INVALID_PASSPORT', p_new.passport_no, app.id_pattern('passport'));
  end if;
  if fresh or p_new.unified_number is distinct from p_old.unified_number then
    perform app.assert_id_format('INVALID_UNIFIED_NUMBER', p_new.unified_number, app.id_pattern('unified'));
  end if;
  if fresh or p_new.cr_number is distinct from p_old.cr_number then
    perform app.assert_id_format('INVALID_CR_NUMBER', p_new.cr_number, app.id_pattern('cr'));
  end if;
  if fresh or p_new.vat_number is distinct from p_old.vat_number then
    perform app.assert_id_format('INVALID_VAT_NUMBER', p_new.vat_number, app.id_pattern('vat'));
  end if;
  if fresh or p_new.rep_id_number is distinct from p_old.rep_id_number then
    perform app.assert_id_format('INVALID_REP_ID', p_new.rep_id_number, app.id_pattern('rep'));
  end if;
end;
$$;

create or replace function app.tg_party_identity_normalize() returns trigger
language plpgsql as $$
begin
  new.national_id    := app.digits_only(new.national_id);
  new.iqama_id       := app.digits_only(new.iqama_id);
  new.unified_number := app.digits_only(new.unified_number);
  new.cr_number      := app.digits_only(new.cr_number);
  new.vat_number     := app.digits_only(new.vat_number);
  new.rep_id_number  := app.digits_only(new.rep_id_number);
  new.passport_no    := nullif(upper(regexp_replace(coalesce(new.passport_no, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.rep_phone_raw  := nullif(trim(coalesce(new.rep_phone_raw, '')), '');
  new.id_exempt_reason := nullif(trim(coalesce(new.id_exempt_reason, '')), '');
  -- Derive only when a raw phone was supplied, so clearing the field actually clears it.
  if new.rep_phone_raw is not null then
    new.rep_phone_e164 := app.normalize_phone_e164(new.rep_phone_raw);
  end if;

  -- OLD is NULL on INSERT, which assert_party_id_formats reads as "validate everything".
  perform app.assert_party_id_formats(new, old);
  return new;
end;
$$;

drop trigger if exists party_identity_normalize on app.party;
create trigger party_identity_normalize before insert or update on app.party
  for each row execute function app.tg_party_identity_normalize();

-- ---------------------------------------------------------------------------
-- 4. Uniqueness + the completeness rule (AFTER — generated columns are only populated by then).
-- ---------------------------------------------------------------------------
create or replace function app.tg_party_identity_rules() returns trigger
language plpgsql as $$
declare v_dup uuid;
begin
  if new.primary_id is not null and new.deleted_at is null then
    select id into v_dup from app.party
     where org_id = new.org_id and primary_id = new.primary_id
       and id <> new.id and deleted_at is null
     limit 1;
    if v_dup is not null then
      raise exception 'DUPLICATE_IDENTIFIER: % is already used by party %', new.primary_id, v_dup
        using errcode = 'unique_violation';
    end if;
  end if;

  -- New records must be complete. Existing incomplete records stay editable (they carry the
  -- "بيانات ناقصة" badge), but a record that was complete may not be emptied back out.
  if not new.identity_complete and (tg_op = 'INSERT' or old.identity_complete) then
    raise exception 'IDENTITY_INCOMPLETE: tenant % is missing its primary identifier', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- NOT "party_identity_guard" — 0013 already owns that name for the Party↔Identity no-auto-link
-- guard, and reusing it would drop a security trigger.
drop trigger if exists party_identity_rules on app.party;
create trigger party_identity_rules after insert or update on app.party
  for each row execute function app.tg_party_identity_rules();

-- ---------------------------------------------------------------------------
-- 5. tenant.tenant_type / tenant_kind become maintained mirrors of party.entity_type.
-- Removes the three-parallel-columns drift (legal_kind / tenant_kind / tenant_type) without
-- dropping anything that existing reads depend on.
-- ---------------------------------------------------------------------------
create or replace function app.tg_tenant_type_sync() returns trigger
language plpgsql as $$
declare v_type text;
begin
  select coalesce(entity_type, 'individual') into v_type from app.party where id = new.party_id;
  new.tenant_type := coalesce(v_type, 'individual');
  new.tenant_kind := (case when new.tenant_type = 'company' then 'company' else 'individual' end)::app.legal_kind;
  return new;
end;
$$;

drop trigger if exists tenant_type_sync on app.tenant;
create trigger tenant_type_sync before insert or update on app.tenant
  for each row execute function app.tg_tenant_type_sync();

create or replace function app.tg_party_type_propagate() returns trigger
language plpgsql as $$
begin
  update app.tenant
     set tenant_type = coalesce(new.entity_type, 'individual'),
         tenant_kind = (case when new.entity_type = 'company' then 'company' else 'individual' end)::app.legal_kind
   where party_id = new.id;
  return null;
end;
$$;

drop trigger if exists party_type_propagate on app.party;
create trigger party_type_propagate after update of entity_type on app.party
  for each row when (old.entity_type is distinct from new.entity_type)
  execute function app.tg_party_type_propagate();

-- ---------------------------------------------------------------------------
-- 6. Trade-name catalogue. One commercial registration runs several brand names, each under its own
-- municipal licence. The contract keeps its frozen trade_name TEXT (it is a legal document and must
-- record the name as signed); trade_name_id only records which catalogue entry it came from.
-- ---------------------------------------------------------------------------
create table if not exists app.trade_name (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references app.organization(id) on delete cascade,
  party_id             uuid not null references app.party(id) on delete cascade,
  name                 text not null,
  municipal_license_no text,          -- رقم رخصة البلدية
  license_expiry       date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  deleted_by           uuid,
  deleted_reason       text
);

create unique index if not exists trade_name_uniq on app.trade_name (org_id, party_id, name)
  where deleted_at is null;
create index if not exists trade_name_party_idx on app.trade_name (party_id) where deleted_at is null;

drop trigger if exists trade_name_set_updated_at on app.trade_name;
create trigger trade_name_set_updated_at before update on app.trade_name
  for each row execute function app.set_updated_at();

alter table app.trade_name enable row level security;
drop policy if exists trade_name_all on app.trade_name;
create policy trade_name_all on app.trade_name for all
  using (app.has_org_access(org_id)) with check (app.has_org_access(org_id));

-- 0001's default privileges cover functions only, so tables need an explicit grant. No DELETE:
-- brands are retired with deleted_at like every other record here.
grant select, insert, update on app.trade_name to authenticated;

-- Outside the tg_contract_immutable frozen set (0013), so it stays correctable after activation.
alter table app.contract add column if not exists trade_name_id uuid references app.trade_name(id);
create index if not exists contract_trade_name_idx on app.contract (trade_name_id)
  where trade_name_id is not null;

-- ================================================================
-- 0058_import_tenant_identity.sql
-- ================================================================
-- 0058_import_tenant_identity.sql
-- Sprint M-2: teach the importer the identity rules that 0057 put on app.party.
--
-- Without this the tenants importer is simply broken: it inserts a party with roles={tenant} and no
-- identifier, which 0057's guard refuses, and because import_commit runs as one transaction a single
-- such row would abort the whole batch with a raw Postgres error. Requirements have to be caught
-- during VALIDATE, where they become a per-field message on the offending row.
--
-- import_validate and import_commit are re-emitted here because Postgres has no way to patch one
-- branch of a function. To keep that re-emission honest, the tenant logic is first extracted into
-- small functions of its own — the two big functions differ from their previous versions (0047 and
-- 0016) only in the two branches that now delegate.
--
-- New optional sheet columns: رقم الإقامة · رقم الجواز · الرقم الموحد · السجل التجاري ·
-- الرقم الضريبي · اسم الممثل · رقم هوية الممثل · صفة الممثل · جوال الممثل.

-- ---------------------------------------------------------------------------
-- Tenant type from the Arabic sheet value. Unknown or blank reads as an individual, which is what
-- the column already defaulted to before this migration.
-- ---------------------------------------------------------------------------
create or replace function app.map_entity_type(p_value text) returns text
language sql immutable as $$
  select case
    when p_value is null or btrim(p_value) = '' then 'individual'
    when btrim(p_value) in ('شركة', 'شركه') or lower(btrim(p_value)) = 'company' then 'company'
    when btrim(p_value) like 'مؤسس%' or lower(btrim(p_value)) in ('establishment', 'sole_establishment')
      then 'sole_establishment'
    else 'individual'
  end;
$$;

-- ---------------------------------------------------------------------------
-- The identifier columns, normalised exactly the way app.party stores them, so what validate checks
-- is what commit will write.
-- ---------------------------------------------------------------------------
create or replace function app.import_tenant_ids(p_raw jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'national_id',    app.digits_only(p_raw->>'رقم الهوية'),
    'iqama_id',       app.digits_only(p_raw->>'رقم الإقامة'),
    'passport_no',    nullif(upper(regexp_replace(coalesce(p_raw->>'رقم الجواز', ''), '[^A-Za-z0-9]', '', 'g')), ''),
    'unified_number', app.digits_only(p_raw->>'الرقم الموحد'),
    'cr_number',      app.digits_only(p_raw->>'السجل التجاري'),
    'vat_number',     app.digits_only(p_raw->>'الرقم الضريبي'),
    'rep_id_number',  app.digits_only(p_raw->>'رقم هوية الممثل'),
    'rep_name',       nullif(btrim(coalesce(p_raw->>'اسم الممثل', '')), ''),
    'rep_capacity',   nullif(btrim(coalesce(p_raw->>'صفة الممثل', '')), ''),
    'rep_phone_raw',  nullif(btrim(coalesce(p_raw->>'جوال الممثل', '')), '')
  ));
$$;

-- ---------------------------------------------------------------------------
-- Every reason this tenant row cannot be accepted, as import_err entries. Messages are Arabic and
-- user-facing; the shapes themselves come from app.id_pattern so they cannot drift from the guard.
-- ---------------------------------------------------------------------------
create or replace function app.import_tenant_errors(p_ids jsonb, p_type text) returns jsonb
language plpgsql immutable as $$
declare
  errs jsonb := '[]'::jsonb;
  n_personal int := num_nonnulls(p_ids->>'national_id', p_ids->>'iqama_id', p_ids->>'passport_no');
begin
  if p_type = 'individual' then
    if n_personal = 0 then
      errs := errs || app.import_err('رقم الهوية', null::text, 'مطلوب: رقم الهوية أو الإقامة أو الجواز');
    elsif n_personal > 1 then
      errs := errs || app.import_err('رقم الهوية', null::text, 'اكتب معرّفاً واحداً فقط لكل مستأجر');
    end if;
  else
    if p_ids->>'unified_number' is null then
      errs := errs || app.import_err('الرقم الموحد', null::text, 'مطلوب للمؤسسة والشركة');
    end if;
    if p_ids->>'rep_name' is null then
      errs := errs || app.import_err('اسم الممثل', null::text, 'مطلوب للمؤسسة والشركة');
    end if;
    if p_ids->>'rep_id_number' is null then
      errs := errs || app.import_err('رقم هوية الممثل', null::text, 'مطلوب للمؤسسة والشركة');
    end if;
    if app.normalize_phone_e164(p_ids->>'rep_phone_raw') is null then
      errs := errs || app.import_err('جوال الممثل', p_ids->>'rep_phone_raw', 'مطلوب ويجب أن يكون رقماً صالحاً');
    end if;
  end if;

  if p_ids->>'national_id' is not null and p_ids->>'national_id' !~ app.id_pattern('national') then
    errs := errs || app.import_err('رقم الهوية', p_ids->>'national_id', 'يجب أن يكون 10 أرقام تبدأ بـ 1');
  end if;
  if p_ids->>'iqama_id' is not null and p_ids->>'iqama_id' !~ app.id_pattern('iqama') then
    errs := errs || app.import_err('رقم الإقامة', p_ids->>'iqama_id', 'يجب أن يكون 10 أرقام تبدأ بـ 2');
  end if;
  if p_ids->>'unified_number' is not null and p_ids->>'unified_number' !~ app.id_pattern('unified') then
    errs := errs || app.import_err('الرقم الموحد', p_ids->>'unified_number', 'يجب أن يكون 10 أرقام تبدأ بـ 7');
  end if;
  if p_ids->>'cr_number' is not null and p_ids->>'cr_number' !~ app.id_pattern('cr') then
    errs := errs || app.import_err('السجل التجاري', p_ids->>'cr_number', 'يجب أن يكون 10 أرقام');
  end if;
  if p_ids->>'vat_number' is not null and p_ids->>'vat_number' !~ app.id_pattern('vat') then
    errs := errs || app.import_err('الرقم الضريبي', p_ids->>'vat_number', 'يجب أن يكون 15 رقماً يبدأ وينتهي بـ 3');
  end if;
  if p_ids->>'rep_id_number' is not null and p_ids->>'rep_id_number' !~ app.id_pattern('rep') then
    errs := errs || app.import_err('رقم هوية الممثل', p_ids->>'rep_id_number', 'يجب أن يكون 10 أرقام تبدأ بـ 1 أو 2');
  end if;
  return errs;
end;
$$;

-- ---------------------------------------------------------------------------
-- One tenant row: name, contact, type, identifiers, and both duplicate checks. Returns
-- {"normalized": {...}, "errors": [...]} so the caller stays two lines long.
-- ---------------------------------------------------------------------------
create or replace function app.import_validate_tenant(p_org uuid, p_batch uuid, p_row int, p_raw jsonb)
returns jsonb
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  norm  jsonb := '{}'::jsonb;
  errs  jsonb := '[]'::jsonb;
  ids   jsonb := app.import_tenant_ids(p_raw);
  v_type text := app.map_entity_type(p_raw->>'النوع');
  v_primary text;
  s     text;
begin
  s := nullif(btrim(p_raw->>'الاسم'), '');
  if s is null then errs := errs || app.import_err('الاسم', p_raw->>'الاسم', 'حقل مطلوب');
  else norm := norm || jsonb_build_object('display_name', s); end if;

  s := btrim(coalesce(p_raw->>'الجوال', ''));
  if s <> '' then
    if app.normalize_phone_e164(s) is null
      then errs := errs || app.import_err('الجوال', s, 'رقم جوال غير صالح');
      else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(s), 'phone_raw', s);
    end if;
  end if;

  -- For an establishment the personal columns describe the REPRESENTATIVE, so they are not carried
  -- onto the entity itself. app.party would refuse both anyway (one identifier per row).
  if v_type <> 'individual' then
    ids := ids - 'national_id' - 'iqama_id' - 'passport_no';
  end if;
  errs := errs || app.import_tenant_errors(ids, v_type);

  v_primary := coalesce(ids->>'unified_number', ids->>'national_id', ids->>'iqama_id', ids->>'passport_no');
  if v_primary is not null then
    if exists (select 1 from app.party
                where org_id = p_org and primary_id = v_primary and deleted_at is null) then
      errs := errs || app.import_err('المعرّف', v_primary, 'يوجد مستأجر بنفس المعرّف في المنصة');
    elsif exists (select 1 from app.import_row
                   where batch_id = p_batch and row_number < p_row and normalized->>'primary_id' = v_primary) then
      errs := errs || app.import_err('المعرّف', v_primary, 'مكرّر داخل هذا الملف');
    end if;
  end if;

  return jsonb_build_object(
    'normalized', norm || ids || jsonb_build_object(
      'entity_type', v_type,
      'legal_kind',  case when v_type = 'company' then 'company' else 'individual' end,
      'primary_id',  v_primary,
      'email',       nullif(btrim(coalesce(p_raw->>'البريد الإلكتروني', '')), '')),
    'errors', errs);
end;
$$;

-- tenant.tenant_type / tenant_kind are maintained by the 0057 trigger, so they are not written here.
create or replace function app.import_commit_tenant(p_org uuid, p_norm jsonb) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare v_party uuid; v_tenant uuid;
begin
  insert into app.party (org_id, display_name, legal_kind, entity_type,
                         national_id, iqama_id, passport_no,
                         unified_number, cr_number, vat_number,
                         rep_name, rep_id_number, rep_capacity, rep_phone_raw,
                         phone_e164, phone_raw, email, roles)
  values (p_org, p_norm->>'display_name', (p_norm->>'legal_kind')::app.legal_kind, p_norm->>'entity_type',
          p_norm->>'national_id', p_norm->>'iqama_id', p_norm->>'passport_no',
          p_norm->>'unified_number', p_norm->>'cr_number', p_norm->>'vat_number',
          p_norm->>'rep_name', p_norm->>'rep_id_number', p_norm->>'rep_capacity', p_norm->>'rep_phone_raw',
          -- Schema-qualified on purpose: citext lives in public (0001) while this function's
          -- search_path is app, so the bare type name does not resolve. The 0016 tenants branch
          -- carried the unqualified cast and failed the moment it was reached.
          p_norm->>'phone_e164', p_norm->>'phone_raw', (p_norm->>'email')::public.citext,
          array['tenant']::app.party_role[])
  returning id into v_party;

  insert into app.tenant (org_id, party_id) values (p_org, v_party) returning id into v_tenant;
  return v_tenant;
end;
$$;

-- ===========================================================================
-- import_validate — re-emitted from 0047. Only the 'tenants' branch changed.
-- ===========================================================================
create or replace function app.import_validate(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  r      app.import_row;
  norm   jsonb;
  errs   jsonb;
  res    jsonb;
  s      text;
  amt    bigint;
  num    numeric;
  ph     text;
  d1     date;
  d2     date;
  ref_id uuid;
  ref2   uuid;
  n_valid int := 0;
  n_error int := 0;
  n_total int := 0;
begin
  select org_id, kind into v_org, v_kind from app.import_batch where id = p_batch;
  if v_org is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch order by row_number loop
    n_total := n_total + 1;

    -- One unreadable cell fails its own row. Every conversion below is meant to be guarded
    -- already; this is the boundary that keeps the next missed one from costing the batch.
    begin
      norm := '{}'::jsonb;
      errs := '[]'::jsonb;

      if v_kind = 'properties' then
        s := nullif(trim(r.raw->>'اسم العقار'), '');
        if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('name', s); end if;
        norm := norm || jsonb_build_object(
          'property_kind', app.map_property_kind(r.raw->>'نوع العقار'),
          'deed_number',   nullif(trim(r.raw->>'رقم الصك'), ''),
          'city',          nullif(trim(r.raw->>'المدينة'), ''),
          'district',      nullif(trim(r.raw->>'الحي'), ''),
          'address_line',  nullif(trim(r.raw->>'العنوان'), ''),
          'owner_name',    nullif(trim(r.raw->>'اسم المالك'), ''));

      elsif v_kind = 'owners' then
        s := nullif(trim(r.raw->>'الاسم'), '');
        if s is null then errs := errs || app.import_err('الاسم', r.raw->>'الاسم', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('display_name', s); end if;
        ph := r.raw->>'الجوال';
        if ph is not null and trim(ph) <> '' then
          if app.normalize_phone_e164(ph) is null
            then errs := errs || app.import_err('الجوال', ph, 'رقم جوال غير صالح');
            else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(ph), 'phone_raw', ph);
          end if;
        end if;
        norm := norm || jsonb_build_object(
          'legal_kind', app.map_legal_kind(r.raw->>'النوع'),
          'national_id', nullif(trim(r.raw->>'رقم الهوية'), ''),
          'iban', nullif(trim(r.raw->>'الآيبان'), ''),
          'bank_name', nullif(trim(r.raw->>'البنك'), ''));

      elsif v_kind = 'tenants' then
        res  := app.import_validate_tenant(v_org, p_batch, r.row_number, r.raw);
        norm := res->'normalized';
        errs := res->'errors';

      elsif v_kind = 'units' then
        s := nullif(trim(r.raw->>'اسم العقار'), '');
        if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
        else
          select id into ref_id from app.property
            where org_id = v_org and name = s and deleted_at is null limit 1;
          if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود في المنصة');
          else norm := norm || jsonb_build_object('property_id', ref_id); end if;
        end if;
        s := nullif(trim(r.raw->>'رقم الوحدة'), '');
        if s is null then errs := errs || app.import_err('رقم الوحدة', r.raw->>'رقم الوحدة', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('unit_number', s); end if;
        -- Optional, but import_commit casts it to numeric — so prove it is readable here.
        s := nullif(trim(r.raw->>'المساحة'), '');
        if s is not null then
          num := app.normalize_decimal(s);
          if num is null or num < 0 then errs := errs || app.import_err('المساحة', s, 'مساحة غير صالحة');
          else norm := norm || jsonb_build_object('area_sqm', num); end if;
        end if;
        norm := norm || jsonb_build_object(
          'floor', nullif(trim(r.raw->>'الدور'), ''),
          'current_status', app.map_unit_status(r.raw->>'الحالة'));

      elsif v_kind = 'contracts' then
        s := nullif(trim(r.raw->>'رقم العقد'), '');
        if s is null then errs := errs || app.import_err('رقم العقد', r.raw->>'رقم العقد', 'حقل مطلوب');
        else norm := norm || jsonb_build_object('contract_number', s); end if;
        -- property
        s := nullif(trim(r.raw->>'اسم العقار'), '');
        select id into ref_id from app.property where org_id = v_org and name = s and deleted_at is null limit 1;
        if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود');
        else
          norm := norm || jsonb_build_object('property_id', ref_id);
          -- unit within property
          s := nullif(trim(r.raw->>'رقم الوحدة'), '');
          select id into ref2 from app.unit where property_id = ref_id and unit_number = s and deleted_at is null limit 1;
          if ref2 is null then errs := errs || app.import_err('رقم الوحدة', s, 'الوحدة غير موجودة في هذا العقار');
          else norm := norm || jsonb_build_object('unit_id', ref2); end if;
        end if;
        -- tenant by identifier or name. The identifier column now matches any primary id, so a sheet
        -- that carries a company's unified number resolves the same way a national id does.
        s := nullif(btrim(coalesce(r.raw->>'رقم هوية المستأجر', '')), '');
        ref_id := null;
        if s is not null then
          -- Matched in both normalised forms, since a passport is letters+digits and everything
          -- else is digits-only, and the sheet does not say which one it carries.
          select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
            where t.org_id = v_org and t.deleted_at is null
              and p.primary_id in (app.digits_only(s), nullif(upper(regexp_replace(s, '[^A-Za-z0-9]', '', 'g')), ''))
            limit 1;
        end if;
        if ref_id is null then
          s := nullif(trim(r.raw->>'اسم المستأجر'), '');
          select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
            where t.org_id = v_org and p.display_name = s and t.deleted_at is null limit 1;
        end if;
        if ref_id is null then errs := errs || app.import_err('المستأجر', coalesce(r.raw->>'اسم المستأجر', r.raw->>'رقم هوية المستأجر'), 'المستأجر غير موجود');
        else norm := norm || jsonb_build_object('tenant_id', ref_id); end if;
        -- dates
        d1 := app.normalize_date(r.raw->>'تاريخ البداية');
        d2 := app.normalize_date(r.raw->>'تاريخ النهاية');
        if d1 is null then errs := errs || app.import_err('تاريخ البداية', r.raw->>'تاريخ البداية', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('start_date', d1); end if;
        if d2 is null then errs := errs || app.import_err('تاريخ النهاية', r.raw->>'تاريخ النهاية', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('end_date', d2); end if;
        if d1 is not null and d2 is not null and d2 < d1 then
          errs := errs || app.import_err('تاريخ النهاية', d2::text, 'تاريخ النهاية قبل البداية');
        end if;
        -- amounts
        amt := app.normalize_amount_halalas(r.raw->>'الإيجار السنوي');
        if amt is null then errs := errs || app.import_err('الإيجار السنوي', r.raw->>'الإيجار السنوي', 'مبلغ غير صالح');
        else norm := norm || jsonb_build_object('annual_rent_halalas', amt); end if;
        norm := norm || jsonb_build_object(
          'deposit_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'التأمين'), 0),
          'service_fees_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'رسوم الخدمات'), 0),
          'payment_frequency', app.map_payment_frequency(r.raw->>'دورية الدفع'),
          'ejar_contract_number', nullif(trim(r.raw->>'رقم عقد إيجار'), ''),
          'deed_number', nullif(trim(r.raw->>'رقم الصك'), ''),
          'trade_name', nullif(trim(r.raw->>'الاسم التجاري'), ''));

      elsif v_kind = 'charges' then
        s := nullif(trim(r.raw->>'رقم العقد'), '');
        select id into ref_id from app.contract
          where org_id = v_org and contract_number = s and deleted_at is null limit 1;
        if ref_id is null then errs := errs || app.import_err('رقم العقد', s, 'العقد غير موجود');
        else
          norm := norm || jsonb_build_object('contract_id', ref_id);
          norm := norm || (select jsonb_build_object('property_id', property_id, 'unit_id', unit_id)
                           from app.contract where id = ref_id);
        end if;
        if app.map_charge_type(r.raw->>'نوع الاستحقاق') is null then
          errs := errs || app.import_err('نوع الاستحقاق', r.raw->>'نوع الاستحقاق', 'نوع غير معروف');
        else norm := norm || jsonb_build_object('charge_type', app.map_charge_type(r.raw->>'نوع الاستحقاق')); end if;
        d1 := app.normalize_date(r.raw->>'تاريخ الاستحقاق');
        if d1 is null then errs := errs || app.import_err('تاريخ الاستحقاق', r.raw->>'تاريخ الاستحقاق', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('due_date', d1); end if;
        -- VAT rate defaults to 0 (residential rent is exempt); the sheet may override it.
        s := nullif(trim(r.raw->>'نسبة الضريبة'), '');
        if s is null then num := 0;
        else
          num := app.normalize_rate(s);
          if num is null then
            errs := errs || app.import_err('نسبة الضريبة', s, 'نسبة غير صالحة — اكتب 0.15 أو 15%');
          end if;
        end if;
        amt := app.normalize_amount_halalas(r.raw->>'المبلغ قبل الضريبة');
        if amt is null then errs := errs || app.import_err('المبلغ قبل الضريبة', r.raw->>'المبلغ قبل الضريبة', 'مبلغ غير صالح');
        elsif num is not null then
          norm := norm || jsonb_build_object(
            'amount_excl_vat_halalas', amt,
            'vat_rate', num,
            'vat_amount_halalas', round(amt * num)::bigint);
        end if;
        norm := norm || jsonb_build_object('description', nullif(trim(r.raw->>'الوصف'), ''));
      end if;

      update app.import_row
        set normalized = norm, errors = errs, is_valid = (jsonb_array_length(errs) = 0)
        where id = r.id;
      if jsonb_array_length(errs) = 0 then n_valid := n_valid + 1; else n_error := n_error + 1; end if;

    exception when data_exception then
      update app.import_row
        set normalized = '{}'::jsonb,
            errors = jsonb_build_array(app.import_err('الصف', null::text, 'تعذّرت قراءة هذا الصف: ' || sqlerrm)),
            is_valid = false
        where id = r.id;
      n_error := n_error + 1;
    end;
  end loop;

  update app.import_batch
    set status = 'validated', total_rows = n_total, valid_rows = n_valid, error_rows = n_error
    where id = p_batch;
end;
$$;

-- ===========================================================================
-- import_commit — re-emitted from 0016. Only the 'tenants' branch and the contract trade_name
-- passthrough changed.
-- ===========================================================================
create or replace function app.import_commit(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  v_status app.import_status;
  r      app.import_row;
  n      jsonb;
  new_id uuid;
  v_party uuid;
  v_owner uuid;
begin
  select org_id, kind, status into v_org, v_kind, v_status from app.import_batch where id = p_batch;
  if v_org is null then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if v_status <> 'validated' then
    raise exception 'IMPORT_NOT_VALIDATED: run import_validate first' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch and is_valid order by row_number loop
    n := r.normalized;

    if v_kind = 'properties' then
      -- resolve owner: explicit owner_name → find-or-create; else self owner
      if coalesce(n->>'owner_name', '') <> '' then
        select o.id into v_owner from app.owner o join app.party p on p.id = o.party_id
          where o.org_id = v_org and p.display_name = n->>'owner_name' and o.deleted_at is null limit 1;
        if v_owner is null then
          insert into app.party (org_id, display_name, roles) values (v_org, n->>'owner_name', array['owner']::app.party_role[])
            returning id into v_party;
          insert into app.owner (org_id, party_id) values (v_org, v_party) returning id into v_owner;
        end if;
      else
        v_owner := app.self_owner_id(v_org);
      end if;
      insert into app.property (org_id, owner_id, name, property_kind, deed_number, city, district, address_line)
      values (v_org, v_owner, n->>'name', (n->>'property_kind')::app.property_kind,
              n->>'deed_number', n->>'city', n->>'district', n->>'address_line')
      returning id into new_id;
      update app.import_row set created_entity_type = 'property', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'owners' then
      insert into app.party (org_id, display_name, legal_kind, national_id, phone_e164, phone_raw, roles)
      values (v_org, n->>'display_name', (n->>'legal_kind')::app.legal_kind, n->>'national_id',
              n->>'phone_e164', n->>'phone_raw', array['owner']::app.party_role[])
      returning id into v_party;
      insert into app.owner (org_id, party_id, owner_kind, iban, bank_name)
      values (v_org, v_party, (n->>'legal_kind')::app.legal_kind, n->>'iban', n->>'bank_name')
      returning id into new_id;
      update app.import_row set created_entity_type = 'owner', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'tenants' then
      new_id := app.import_commit_tenant(v_org, n);
      update app.import_row set created_entity_type = 'tenant', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'units' then
      insert into app.unit (org_id, property_id, unit_number, floor, area_sqm, current_status)
      values (v_org, (n->>'property_id')::uuid, n->>'unit_number', n->>'floor',
              nullif(n->>'area_sqm', '')::numeric, (n->>'current_status')::app.unit_status)
      returning id into new_id;
      update app.import_row set created_entity_type = 'unit', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'contracts' then
      insert into app.contract (org_id, property_id, unit_id, tenant_id, contract_number,
                                ejar_contract_number, deed_number, start_date, end_date,
                                annual_rent_halalas, payment_frequency, deposit_halalas, service_fees_halalas,
                                trade_name, status)
      values (v_org, (n->>'property_id')::uuid, (n->>'unit_id')::uuid, (n->>'tenant_id')::uuid,
              n->>'contract_number', n->>'ejar_contract_number', n->>'deed_number',
              (n->>'start_date')::date, (n->>'end_date')::date,
              (n->>'annual_rent_halalas')::bigint, (n->>'payment_frequency')::app.payment_frequency,
              (n->>'deposit_halalas')::bigint, (n->>'service_fees_halalas')::bigint,
              n->>'trade_name', 'draft')
      returning id into new_id;
      update app.import_row set created_entity_type = 'contract', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'charges' then
      insert into app.charge (org_id, property_id, unit_id, contract_id, charge_type, due_date,
                              amount_excl_vat_halalas, vat_rate, vat_amount_halalas, description)
      values (v_org, (n->>'property_id')::uuid, nullif(n->>'unit_id','')::uuid, (n->>'contract_id')::uuid,
              (n->>'charge_type')::app.charge_type, (n->>'due_date')::date,
              (n->>'amount_excl_vat_halalas')::bigint, (n->>'vat_rate')::numeric,
              (n->>'vat_amount_halalas')::bigint, n->>'description')
      returning id into new_id;
      update app.import_row set created_entity_type = 'charge', created_entity_id = new_id where id = r.id;
    end if;
  end loop;

  update app.import_batch set status = 'committed', committed_at = now() where id = p_batch;
  perform app.write_audit(v_org, 'import.commit', 'import_batch', p_batch,
                          jsonb_build_object('kind', v_kind));
end;
$$;

-- ================================================================
-- 0059_notification_sweep.sql
-- ================================================================
-- 0059_notification_sweep.sql
-- Launch sprint: move notification generation off page render and onto Cron.
--
-- The defect: app/app/notifications/page.tsx called generate_notifications + enqueue_email_deliveries
-- during render. Two consequences, both bad:
--   * every view of that page performed write work, on a page that is read far more than it changes;
--   * an office whose staff never open the page generated NO notifications and queued NO email at
--     all — so the reminder that a rent charge is overdue depended on somebody already looking.
--
-- Cron cannot simply call the existing functions: both are SECURITY DEFINER gated on
-- app.has_org_access(p_org), which resolves against auth.uid(). service_role has no membership, so
-- every call would raise FORBIDDEN. The gate is correct and stays; what is needed is to separate the
-- WORK from the AUTHORISATION so the same work can be reached by two callers with different rights.
--
-- Shape: *_for(org) does the work with no gate and is reachable only by service_role; the original
-- names keep their gate and delegate. One body, two doors.
--
-- 0053 rule: migration 0001 declares
--   alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;
-- so `revoke from public` does NOT close a new function. anon and authenticated must be revoked by
-- name, or the ungated *_for functions would be callable by any signed-in user for ANY org.

-- ---------------------------------------------------------------------------
-- 1. The work, without the gate. NEVER grant these to authenticated.
-- ---------------------------------------------------------------------------
create or replace function app.generate_notifications_for(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  -- Charges due within 7 days, not yet settled.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_due_soon', 'charge', c.id,
         'استحقاق قريب', 'دفعة تستحق بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and not cb.is_settled
    and c.due_date >= current_date and c.due_date <= current_date + 7
  on conflict do nothing;

  -- Overdue unsettled charges.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_overdue', 'charge', c.id,
         'دفعة متأخرة', 'دفعة متأخرة استحقّت بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and cb.is_overdue and not cb.is_settled
  on conflict do nothing;

  -- Active contracts ending within 30 days with no successor renewal yet.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select ct.org_id, ct.property_id, 'contract_expiring', 'contract', ct.id,
         'عقد ينتهي قريباً', 'العقد ' || ct.contract_number || ' ينتهي بتاريخ ' || ct.end_date, ct.end_date
  from app.contract ct
  where ct.org_id = p_org and ct.status = 'active' and ct.deleted_at is null
    and ct.end_date >= current_date and ct.end_date <= current_date + 30
    and not exists (
      select 1 from app.contract r
      where r.renewed_from_contract_id = ct.id and r.deleted_at is null and r.status <> 'cancelled')
  on conflict do nothing;

  return (select count(*)::int from app.notification where org_id = p_org and read_at is null);
end;
$$;

create or replace function app.enqueue_email_deliveries_for(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_count int;
begin
  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.org_id = p_org and n.read_at is null
  on conflict (notification_id, channel, target) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.generate_notifications_for(uuid)    from public, anon, authenticated;
revoke all on function app.enqueue_email_deliveries_for(uuid)  from public, anon, authenticated;
grant execute on function app.generate_notifications_for(uuid)   to service_role;
grant execute on function app.enqueue_email_deliveries_for(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The member-facing names keep their gate and delegate. Same behaviour as before for any caller
-- that already had the right; the office "refresh" button still works.
-- ---------------------------------------------------------------------------
create or replace function app.generate_notifications(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return app.generate_notifications_for(p_org);
end;
$$;

create or replace function app.enqueue_email_deliveries(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.has_org_access(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return app.enqueue_email_deliveries_for(p_org);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The sweep the Cron job calls. Skips soft-deleted offices and those whose subscription is no
-- longer live — a cancelled office should stop receiving reminders, not keep being e-mailed.
-- ---------------------------------------------------------------------------
create or replace function app.sweep_notifications()
-- `unread` is the total unread count across swept offices, not the number created this run —
-- generate_notifications_for returns a standing count, and the inserts are ON CONFLICT DO NOTHING.
returns table (orgs int, unread int, queued int)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r record;
  v_orgs int := 0;
  v_unread int := 0;
  v_queued int := 0;
begin
  for r in
    select o.id
      from app.organization o
      left join app.org_subscription s on s.org_id = o.id
     where o.deleted_at is null
       and coalesce(s.status, 'trialing') in ('trialing', 'active', 'past_due', 'comped')
  loop
    v_orgs   := v_orgs + 1;
    v_unread := v_unread + coalesce(app.generate_notifications_for(r.id), 0);
    v_queued := v_queued + coalesce(app.enqueue_email_deliveries_for(r.id), 0);
  end loop;

  return query select v_orgs, v_unread, v_queued;
end;
$$;

revoke all on function app.sweep_notifications() from public, anon, authenticated;
grant execute on function app.sweep_notifications() to service_role;

-- ================================================================
-- 0060_rate_limit.sql
-- ================================================================
-- 0060_rate_limit.sql
-- Launch sprint: throttling for the auth surface.
--
-- Why in the database and not in memory: the app runs on Vercel's serverless functions. An in-memory
-- counter lives inside one instance, so an attacker spreading requests across concurrent invocations
-- gets a fresh allowance each time — the limiter would measure nothing. A row in Postgres is the one
-- piece of state every instance already shares.
--
-- The whole decision is a single atomic upsert. Read-then-write would let two concurrent attempts
-- both read `hits = limit - 1` and both be allowed; there is no lock here because there is no gap.

create table if not exists app.rate_limit (
  -- Caller-supplied and already hashed (see lib/rate-limit.ts): this table must never accumulate
  -- raw e-mail addresses or phone numbers, both because it is unbounded attacker-controlled input
  -- and because PDPL has no reason to see personal data in a throttling counter.
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         int not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists rate_limit_updated_idx on app.rate_limit (updated_at);

-- RLS on with NO policy, the same pattern the platform tables use: nothing reaches this table except
-- through the SECURITY DEFINER function below, which only service_role may call.
alter table app.rate_limit enable row level security;

-- ---------------------------------------------------------------------------
-- Count one attempt and say whether it is allowed.
-- `allowed` is false on the attempt that exceeds the limit, not the one that reaches it.
-- ---------------------------------------------------------------------------
create or replace function app.rate_limit_hit(p_bucket text, p_limit int, p_window_seconds int)
returns table (allowed boolean, remaining int, retry_after int)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_now    timestamptz := now();
  v_expiry interval    := make_interval(secs => greatest(p_window_seconds, 1));
  v_start  timestamptz;
  v_hits   int;
begin
  insert into app.rate_limit as rl (bucket, window_start, hits)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update
     -- An expired window restarts at 1 rather than being deleted and re-inserted, which would race.
     set hits         = case when rl.window_start < v_now - v_expiry then 1 else rl.hits + 1 end,
         window_start = case when rl.window_start < v_now - v_expiry then v_now else rl.window_start end,
         updated_at   = v_now
  returning rl.window_start, rl.hits into v_start, v_hits;

  return query select
    v_hits <= p_limit,
    greatest(p_limit - v_hits, 0),
    greatest(ceil(extract(epoch from (v_start + v_expiry) - v_now))::int, 0);
end;
$$;

-- Housekeeping: buckets older than a day are dead weight. Called from the daily cron.
create or replace function app.rate_limit_sweep() returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_deleted int;
begin
  delete from app.rate_limit where updated_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default, so `revoke from public` alone
-- would leave these open. A signed-out caller reaching rate_limit_hit could burn another account's
-- allowance at will, which turns the defence into the attack.
revoke all on function app.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke all on function app.rate_limit_sweep()             from public, anon, authenticated;
grant execute on function app.rate_limit_hit(text, int, int) to service_role;
grant execute on function app.rate_limit_sweep()             to service_role;

-- ================================================================
-- 0061_pdpl_export_erasure.sql
-- ================================================================
-- 0061_pdpl_export_erasure.sql
-- Launch sprint: the PDPL rights this product has to be able to honour —
-- access/portability (export) and erasure (delete) — for both kinds of data subject.
--
-- There are TWO subjects here and they are not the same person:
--   * the OFFICE, our customer. We are the controller for their account, so their deletion request
--     is ours to execute.
--   * the TENANT or OWNER whose personal data the office holds. There the OFFICE is the controller
--     and we are the processor, so we do not act on a tenant's request — we give the office the
--     tool to act on it. Hence export_party_data / erase_party alongside the org-level pair.
--
-- What erasure cannot touch, and why. PDPL does not override a statutory retention duty: a tax
-- invoice snapshots buyer_name / buyer_id / buyer_vat_number (0023) precisely because ZATCA requires
-- it, and a settled charge is an accounting record. So erase_party redacts the OPERATIONAL record
-- and leaves the FINANCIAL one intact. Promising more than that in the UI would be a lie, and
-- quietly deleting invoices would expose the office to a compliance failure it never chose.

-- ---------------------------------------------------------------------------
-- 1. Marking an erased party, and teaching 0057's completeness flag about it.
-- Without this, erase_party would trip the 0057 guard: nulling the identifiers turns a complete
-- record incomplete, and that transition is exactly what the guard refuses.
-- ---------------------------------------------------------------------------
alter table app.party add column if not exists erased_at     timestamptz;
alter table app.party add column if not exists erased_reason text;

drop index if exists app.party_incomplete_idx;
alter table app.party drop column if exists identity_complete;
alter table app.party add column identity_complete boolean
  generated always as (
    case
      -- An erased record is complete by definition: there is nothing left that ought to be filled.
      when erased_at is not null                      then true
      when not ('tenant' = any(roles))                then true
      when coalesce(id_exempt_reason, '') <> ''       then true
      when coalesce(entity_type, 'individual') = 'individual' then
        coalesce(nullif(national_id, ''), nullif(iqama_id, ''), nullif(passport_no, '')) is not null
      else
        nullif(unified_number, '') is not null
        and nullif(rep_name, '')       is not null
        and nullif(rep_id_number, '')  is not null
        and nullif(rep_phone_e164, '') is not null
    end
  ) stored;

create index if not exists party_incomplete_idx on app.party (org_id)
  where not identity_complete and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Export — the access / portability right.
-- Admin-gated: a viewer may read a tenant on screen, but bulk extraction of an office's entire
-- record set is a different act and belongs to whoever is accountable for the account.
-- ---------------------------------------------------------------------------
create or replace function app.export_org_data(p_org uuid) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_out jsonb;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'organization', (select to_jsonb(o) from app.organization o where o.id = p_org),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'role', m.role, 'status', m.status, 'full_name', i.full_name,
                  'email', i.email, 'phone', i.phone_e164, 'joined_at', m.created_at)), '[]'::jsonb)
                from app.membership m join app.identity i on i.id = m.identity_id
                where m.org_id = p_org and m.deleted_at is null),
    'parties',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.party t     where t.org_id = p_org and t.deleted_at is null),
    'properties', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.property t  where t.org_id = p_org and t.deleted_at is null),
    'buildings',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.building t  where t.org_id = p_org and t.deleted_at is null),
    'units',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.unit t      where t.org_id = p_org and t.deleted_at is null),
    'contracts',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.contract t  where t.org_id = p_org and t.deleted_at is null),
    'charges',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.charge t    where t.org_id = p_org and t.deleted_at is null),
    'payments',   (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.payment t   where t.org_id = p_org and t.deleted_at is null),
    'invoices',   (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.invoice t   where t.org_id = p_org)
  ) into v_out;

  perform app.write_audit(p_org, 'pdpl.export_org', 'organization', p_org, jsonb_build_object('scope', 'full'));
  return v_out;
end;
$$;

-- What an office hands a tenant or owner who exercises their right of access. Scoped to one subject:
-- exporting the whole org to answer one person's request would disclose everybody else's data.
create or replace function app.export_party_data(p_org uuid, p_party uuid) returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_out jsonb;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if not exists (select 1 from app.party where id = p_party and org_id = p_org) then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'subject',   (select to_jsonb(t) from app.party t where t.id = p_party),
    'contracts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                  from app.contract c join app.tenant tn on tn.id = c.tenant_id
                  where c.org_id = p_org and tn.party_id = p_party),
    'payments',  (select coalesce(jsonb_agg(to_jsonb(pm)), '[]'::jsonb)
                  from app.payment pm where pm.org_id = p_org and pm.party_id = p_party),
    'invoices',  (select coalesce(jsonb_agg(to_jsonb(iv)), '[]'::jsonb)
                  from app.invoice iv where iv.org_id = p_org and iv.buyer_party_id = p_party),
    'trade_names', (select coalesce(jsonb_agg(to_jsonb(tnm)), '[]'::jsonb)
                  from app.trade_name tnm where tnm.party_id = p_party and tnm.deleted_at is null)
  ) into v_out;

  perform app.write_audit(p_org, 'pdpl.export_party', 'party', p_party, '{}'::jsonb);
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Erasure of one data subject, executed by the office.
-- ---------------------------------------------------------------------------
create or replace function app.erase_party(p_org uuid, p_party uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_active int;
  v_invoices int;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if not exists (select 1 from app.party where id = p_party and org_id = p_org) then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  -- A live tenancy is a contract in force. Erasing the counterparty to a running lease is not a
  -- privacy request the office can grant; end the contract first.
  select count(*) into v_active
    from app.contract c join app.tenant t on t.id = c.tenant_id
   where c.org_id = p_org and t.party_id = p_party and c.status = 'active' and c.deleted_at is null;
  if v_active > 0 then
    raise exception 'ERASE_ACTIVE_CONTRACT: % active contract(s) reference this party', v_active
      using errcode = 'raise_exception';
  end if;

  select count(*) into v_invoices from app.invoice where org_id = p_org and buyer_party_id = p_party;

  update app.party
     set display_name   = 'بيانات محذوفة',
         national_id    = null, iqama_id = null, passport_no = null,
         cr_number      = null, vat_number = null, unified_number = null, cr_expiry = null,
         phone_e164     = null, phone_raw = null, email = null,
         rep_name       = null, rep_id_number = null, rep_capacity = null,
         rep_phone_e164 = null, rep_phone_raw = null,
         id_exempt_reason = null,
         -- Unlink the portal login so the erased record can never be signed into again.
         identity_id    = null,
         erased_at      = now(),
         erased_reason  = p_reason
   where id = p_party;

  -- The signing representative recorded on each contract is personal data too. These columns sit
  -- outside tg_contract_immutable's frozen set (0042), so an activated contract keeps its legal
  -- and financial terms while the person's details go.
  update app.contract c
     set representative_name = null, representative_capacity = null,
         representative_id   = null, representative_phone = null
    from app.tenant t
   where t.id = c.tenant_id and t.party_id = p_party and c.org_id = p_org;

  update app.trade_name set deleted_at = now(), deleted_reason = 'pdpl_erasure'
   where party_id = p_party and deleted_at is null;

  perform app.write_audit(p_org, 'pdpl.erase_party', 'party', p_party,
                          jsonb_build_object('reason', p_reason, 'invoices_retained', v_invoices));

  -- Reported, not hidden: the office has to be able to tell the data subject what was kept and why.
  return jsonb_build_object('erased', true, 'invoices_retained', v_invoices);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Office account deletion, with a grace period.
-- Deliberately NOT immediate. An accidental click here destroys a business's records, and 30 days
-- of reversibility costs nothing next to that.
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists deletion_requested_at timestamptz;
alter table app.organization add column if not exists deletion_requested_by uuid;
alter table app.organization add column if not exists deletion_reason       text;
alter table app.organization add column if not exists purge_after           timestamptz;

-- What survives a purge, and why: these are OUR sales records, not the customer's data. Saudi tax
-- law obliges us as the seller to keep them, and every organization foreign key cascades — so
-- deleting the org row would take our own accounts with it.
create table if not exists app.retained_billing (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,          -- intentionally NOT a foreign key: the org is gone
  org_name           text,
  cr_number          text,
  vat_number         text,
  plan_code          text,
  amount_halalas     bigint,
  status             text,
  gateway_payment_id text,
  paid_at            timestamptz,
  purged_at          timestamptz not null default now()
);
alter table app.retained_billing enable row level security;

create or replace function app.request_org_deletion(p_org uuid, p_reason text default null)
returns timestamptz
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_after timestamptz := now() + interval '30 days';
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.organization
     set deletion_requested_at = now(), deletion_requested_by = auth.uid(),
         deletion_reason = p_reason, purge_after = v_after
   where id = p_org and deleted_at is null;

  perform app.write_audit(p_org, 'pdpl.request_deletion', 'organization', p_org,
                          jsonb_build_object('purge_after', v_after, 'reason', p_reason));
  return v_after;
end;
$$;

create or replace function app.cancel_org_deletion(p_org uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.organization
     set deletion_requested_at = null, deletion_requested_by = null,
         deletion_reason = null, purge_after = null
   where id = p_org;
  perform app.write_audit(p_org, 'pdpl.cancel_deletion', 'organization', p_org, '{}'::jsonb);
end;
$$;

-- The purge itself. Deleting the organization row is what does the work: every org-scoped table
-- already declares `on delete cascade`, so the database removes them all in the right order. That
-- is the point — a hand-maintained list of DELETE statements would silently miss the next table
-- somebody adds, and leave personal data behind under a promise that it was gone.
-- The escape hatch the purge needs, and the reason it is not an escape hatch for anybody else.
--
-- set_config() is callable by any client, so a GUC alone would let a signed-in user switch these
-- guards off — and `authenticated` holds UPDATE on app.membership, which is enough to downgrade the
-- last owner and leave an office with nobody in charge. The role test is what closes that: inside a
-- SECURITY DEFINER function current_user is the definer, while a direct statement from the browser
-- runs as `authenticated`. So the flag only means anything where it was set on purpose.
create or replace function app.org_purge_in_progress() returns boolean
language sql stable set search_path = app, pg_temp as $$
  select coalesce(current_setting('app.allow_org_purge', true), '') = 'on'
     and current_user not in ('authenticated', 'anon');
$$;

-- The last-owner guard (0013) fires when the cascade removes the final owner membership. That guard
-- exists to stop an office locking itself out of its own account — a purpose that does not survive
-- the office being deleted on its own instruction.
create or replace function app.tg_protect_last_owner() returns trigger
language plpgsql as $$
declare
  remaining int;
begin
  if app.org_purge_in_progress() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if old.role = 'owner' and old.status = 'active' and old.deleted_at is null then
    if tg_op = 'DELETE'
       or new.role <> 'owner'
       or new.status <> 'active'
       or new.deleted_at is not null then
      select count(*) into remaining
      from app.membership m
      where m.org_id = old.org_id
        and m.role = 'owner'
        and m.status = 'active'
        and m.deleted_at is null
        and m.id <> old.id;
      if remaining = 0 then
        raise exception 'LAST_OWNER_PROTECTED: cannot remove or downgrade the last active owner of org %', old.org_id
          using errcode = 'raise_exception';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- The two append-only guards have to yield to the purge for the same reason. They protect history
-- from being rewritten inside a live account; they were never meant to make an account undeletable,
-- and a purge that half-completes is worse than either outcome. Both keep refusing everything else.
create or replace function app.tg_audit_immutable() returns trigger
language plpgsql as $$
begin
  if app.org_purge_in_progress() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'AUDIT_APPEND_ONLY: audit_log rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

create or replace function app.tg_subscription_event_immutable() returns trigger
language plpgsql as $$
begin
  if app.org_purge_in_progress() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'SUBSCRIPTION_EVENT_APPEND_ONLY: subscription_event rows cannot be modified or deleted'
    using errcode = 'raise_exception';
end;
$$;

create or replace function app.purge_due_org_deletions()
returns table (purged int)
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  r record;
  v_count int := 0;
begin
  -- Transaction-local: it lapses at commit, so it cannot leak into a later statement.
  perform set_config('app.allow_org_purge', 'on', true);

  for r in
    select id, name, cr_number, vat_number from app.organization
     where purge_after is not null and purge_after <= now()
  loop
    insert into app.retained_billing (org_id, org_name, cr_number, vat_number, plan_code,
                                      amount_halalas, status, gateway_payment_id, paid_at)
    select r.id, r.name, r.cr_number, r.vat_number, sp.plan_code,
           sp.amount_halalas, sp.status::text, sp.gateway_payment_id, sp.paid_at
      from app.subscription_payment sp
     where sp.org_id = r.id and sp.status = 'paid';

    delete from app.organization where id = r.id;
    v_count := v_count + 1;
  end loop;

  perform set_config('app.allow_org_purge', 'off', true);
  return query select v_count;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default. The purge must never be
-- reachable by a customer — it is irreversible and it runs across offices.
revoke all on function app.purge_due_org_deletions() from public, anon, authenticated;
grant execute on function app.purge_due_org_deletions() to service_role;

revoke all on function app.export_org_data(uuid)          from public;
revoke all on function app.export_party_data(uuid, uuid)  from public;
revoke all on function app.erase_party(uuid, uuid, text)  from public;
revoke all on function app.request_org_deletion(uuid, text) from public;
revoke all on function app.cancel_org_deletion(uuid)      from public;
-- These five carry their own is_org_admin gate, so authenticated access is correct and intended.
grant execute on function app.export_org_data(uuid)           to authenticated, service_role;
grant execute on function app.export_party_data(uuid, uuid)   to authenticated, service_role;
grant execute on function app.erase_party(uuid, uuid, text)   to authenticated, service_role;
grant execute on function app.request_org_deletion(uuid, text) to authenticated, service_role;
grant execute on function app.cancel_org_deletion(uuid)       to authenticated, service_role;

-- ================================================================
-- 0062_offline_subscription_payment.sql
-- ================================================================
-- 0062_offline_subscription_payment.sql
-- Paying for a subscription by bank transfer or cash.
--
-- Why: the launch was postponed because electronic payment is not ready. Without an offline path
-- there is no way to onboard a paying office at all, so this is not a convenience feature — it is
-- the only route to revenue until Moyasar goes live, and it has to work alongside it afterwards.
--
-- The shape follows the money, not the UI. An offline payment is the SAME subscription_payment row
-- an online one produces; only who confirms it differs. Moyasar's webhook confirms a card payment;
-- a human operator confirms a transfer after seeing it on the bank statement. Modelling it as a
-- second kind of payment table would have split subscription history in two and broken every
-- report, MRR calculation and audit view that already reads subscription_payment.

-- ---------------------------------------------------------------------------
-- 1. What an offline payment adds to the row.
-- ---------------------------------------------------------------------------
alter table app.subscription_payment add column if not exists method       text;   -- bank_transfer | cash
alter table app.subscription_payment add column if not exists reference    text;   -- what the office typed
alter table app.subscription_payment add column if not exists review_note  text;   -- operator's note on confirm/reject
alter table app.subscription_payment add column if not exists confirmed_by uuid references app.identity(id);
alter table app.subscription_payment add column if not exists confirmed_at timestamptz;

alter table app.subscription_payment drop constraint if exists subscription_payment_method_chk;
alter table app.subscription_payment add constraint subscription_payment_method_chk
  check (method is null or method in ('bank_transfer', 'cash'));

-- Answers "what is waiting for me to confirm" without scanning history.
create index if not exists subscription_payment_pending_idx
  on app.subscription_payment (created_at desc)
  where gateway = 'offline' and status = 'initiated';

-- Where the office is told to send the money. Known keys only — app.operator_set_setting refuses
-- anything it has not seen, so they are seeded here rather than invented at write time.
insert into app.platform_setting (key, value, label_ar) values
  ('bank_name',         '""'::jsonb, 'اسم البنك'),
  ('bank_account_name', '""'::jsonb, 'اسم صاحب الحساب'),
  ('bank_iban',         '""'::jsonb, 'رقم الآيبان'),
  ('offline_payment_note', '""'::jsonb, 'ملاحظة تظهر للمكتب عند التحويل')
on conflict (key) do nothing;

-- Readable by any signed-in office admin: this is OUR account number for receiving money, published
-- on purpose. It is not the platform settings surface, which stays operator-only.
create or replace function app.subscription_bank_details() returns jsonb
language sql stable security definer set search_path = app, pg_temp as $$
  select jsonb_build_object(
    'bank_name',         coalesce((select value from app.platform_setting where key = 'bank_name'), '""'::jsonb),
    'bank_account_name', coalesce((select value from app.platform_setting where key = 'bank_account_name'), '""'::jsonb),
    'bank_iban',         coalesce((select value from app.platform_setting where key = 'bank_iban'), '""'::jsonb),
    'note',              coalesce((select value from app.platform_setting where key = 'offline_payment_note'), '""'::jsonb)
  );
$$;
revoke all on function app.subscription_bank_details() from public, anon;
grant execute on function app.subscription_bank_details() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The office declares a transfer it has already made.
-- This creates an INTENT, never an active subscription. Nothing is granted until a human confirms
-- the money arrived — otherwise anyone could type a reference and unlock a paid plan.
-- ---------------------------------------------------------------------------
create or replace function app.request_offline_payment(p_org uuid, p_plan text, p_method text, p_reference text)
returns app.subscription_payment
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_plan app.plan;
  v_row  app.subscription_payment;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if p_method not in ('bank_transfer', 'cash') then
    raise exception 'INVALID_METHOD' using errcode = 'raise_exception';
  end if;

  select * into v_plan from app.plan where code = p_plan;
  if v_plan.code is null then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not v_plan.is_public or v_plan.price_halalas <= 0 then
    raise exception 'PLAN_NOT_PURCHASABLE: % is not self-serve purchasable', p_plan using errcode = 'raise_exception';
  end if;

  -- One open request at a time. Otherwise a confused office files five, and the operator has to
  -- work out which transfer matches which row.
  if exists (select 1 from app.subscription_payment
              where org_id = p_org and gateway = 'offline' and status = 'initiated') then
    raise exception 'OFFLINE_REQUEST_PENDING: a transfer is already awaiting confirmation'
      using errcode = 'raise_exception';
  end if;

  insert into app.subscription_payment (org_id, plan_code, amount_halalas, gateway, method, reference, status)
  values (p_org, v_plan.code, v_plan.price_halalas, 'offline', p_method, nullif(btrim(p_reference), ''), 'initiated')
  returning * into v_row;

  perform app.write_audit(p_org, 'subscription.offline_requested', 'subscription_payment', v_row.id,
                          jsonb_build_object('plan', v_plan.code, 'method', p_method, 'reference', p_reference));
  return v_row;
end;
$$;

-- The office's own view of what it is waiting on.
create or replace function app.pending_offline_payment(p_org uuid)
returns app.subscription_payment
language plpgsql stable security definer set search_path = app, pg_temp as $$
declare v_row app.subscription_payment;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select * into v_row from app.subscription_payment
   where org_id = p_org and gateway = 'offline' and status = 'initiated'
   order by created_at desc limit 1;
  return v_row;
end;
$$;

-- Cancelling is the office's to do — they may have typed the wrong reference, or changed plan.
create or replace function app.cancel_offline_payment(p_org uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  update app.subscription_payment
     set status = 'failed', review_note = 'ألغاه المكتب'
   where org_id = p_org and gateway = 'offline' and status = 'initiated';
  perform app.write_audit(p_org, 'subscription.offline_cancelled', 'organization', p_org, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The operator side. ADR-0006: every platform function raises FORBIDDEN first.
-- ---------------------------------------------------------------------------
create or replace function app.platform_offline_payments()
returns table (
  id uuid, org_id uuid, org_name text, plan_code text, amount_halalas bigint,
  method text, reference text, created_at timestamptz
)
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select sp.id, sp.org_id, o.name, sp.plan_code, sp.amount_halalas,
           sp.method, sp.reference, sp.created_at
      from app.subscription_payment sp
      join app.organization o on o.id = sp.org_id
     where sp.gateway = 'offline' and sp.status = 'initiated'
     order by sp.created_at;
end;
$$;

-- Confirming is what actually grants the plan. It reuses the same period arithmetic as the online
-- path so a transfer-paying office and a card-paying office end up on identical subscription rows.
create or replace function app.operator_confirm_offline_payment(p_payment uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_pay app.subscription_payment;
  v_end timestamptz;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  select * into v_pay from app.subscription_payment where id = p_payment for update;
  if v_pay.id is null then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_pay.gateway <> 'offline' then
    raise exception 'NOT_AN_OFFLINE_PAYMENT' using errcode = 'raise_exception';
  end if;
  if v_pay.status = 'paid' then
    return;  -- idempotent: a double click must not extend the period twice
  end if;

  v_end := greatest(now(), coalesce((select current_period_end from app.org_subscription where org_id = v_pay.org_id), now()))
           + interval '1 month';

  update app.subscription_payment
     set status = 'paid', paid_at = now(), period_start = now(), period_end = v_end,
         confirmed_by = auth.uid(), confirmed_at = now(), review_note = p_note
   where id = p_payment;

  update app.org_subscription
     set plan_code = v_pay.plan_code, status = 'active', current_period_end = v_end
   where org_id = v_pay.org_id;

  perform app.write_audit(v_pay.org_id, 'platform.confirm_offline_payment', 'subscription_payment', p_payment,
                          jsonb_build_object('plan', v_pay.plan_code, 'amount_halalas', v_pay.amount_halalas,
                                             'method', v_pay.method, 'reference', v_pay.reference, 'note', p_note));
end;
$$;

create or replace function app.operator_reject_offline_payment(p_payment uuid, p_reason text)
returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_pay app.subscription_payment;
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  select * into v_pay from app.subscription_payment where id = p_payment for update;
  if v_pay.id is null or v_pay.gateway <> 'offline' then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if v_pay.status = 'paid' then
    raise exception 'ALREADY_CONFIRMED: reverse it with a refund, not a rejection'
      using errcode = 'raise_exception';
  end if;

  update app.subscription_payment
     set status = 'failed', review_note = p_reason, confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_payment;

  perform app.write_audit(v_pay.org_id, 'platform.reject_offline_payment', 'subscription_payment', p_payment,
                          jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function app.request_offline_payment(uuid, text, text, text)   from public;
revoke all on function app.pending_offline_payment(uuid)                     from public;
revoke all on function app.cancel_offline_payment(uuid)                      from public;
revoke all on function app.platform_offline_payments()                       from public;
revoke all on function app.operator_confirm_offline_payment(uuid, text)      from public;
revoke all on function app.operator_reject_offline_payment(uuid, text)       from public;
grant execute on function app.request_offline_payment(uuid, text, text, text) to authenticated, service_role;
grant execute on function app.pending_offline_payment(uuid)                   to authenticated, service_role;
grant execute on function app.cancel_offline_payment(uuid)                    to authenticated, service_role;
grant execute on function app.platform_offline_payments()                     to authenticated, service_role;
grant execute on function app.operator_confirm_offline_payment(uuid, text)    to authenticated, service_role;
grant execute on function app.operator_reject_offline_payment(uuid, text)     to authenticated, service_role;

-- ================================================================
-- 0063_utilities.sql
-- ================================================================
-- 0063_utilities.sql
-- Utilities module, phase U-1: meters, readings, bills. See docs/foundation/09-utilities-module.md.
--
-- Three decisions govern everything here:
--   1. ONE meter entity with a utility_type, not a table per utility. Electricity and water have
--      identical fields; two tables would duplicate every query, report and RLS policy, and then a
--      third would arrive for gas. utility_type is TEXT + CHECK rather than an enum because
--      `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, which would break the
--      one-shot SQL-Editor apply this project relies on.
--   2. Who bears a bill is DERIVED from the contracts that already exist, never entered. A field a
--      human types will contradict the contracts; a field derived from them cannot.
--   3. NO financial effect. Nothing here writes a charge, a payment or an owner statement. That is
--      what makes "without changing the existing financial models" true literally rather than
--      loosely. Linking bills to charges is a separate, later decision.

-- ---------------------------------------------------------------------------
-- 1. The one change to an existing table: a unique index that lets a composite foreign key prove a
-- unit belongs to the meter's property. Purely additive — no behaviour changes for anything today.
-- ---------------------------------------------------------------------------
alter table app.unit drop constraint if exists unit_id_property_uq;
alter table app.unit add constraint unit_id_property_uq unique (id, property_id);

-- ---------------------------------------------------------------------------
-- 2. The meter.
-- ---------------------------------------------------------------------------
create table if not exists app.utility_meter (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  -- Denormalised beside unit_id on purpose, the same way app.contract carries both: RLS needs the
  -- property scope directly, and a join to reach it would run on every policy check.
  property_id    uuid not null references app.property(id),
  unit_id        uuid,                       -- NULL = a main meter for the whole property
  utility_type   text not null check (utility_type in ('electricity', 'water')),
  meter_number   text not null,
  account_number      text,
  subscription_number text,
  provider       text,
  installed_at   date,
  removed_at     date,
  status         text not null default 'active' check (status in ('active', 'inactive', 'removed')),
  notes          text,
  -- Derived, never entered. A field that CAN contradict reality eventually will.
  meter_level    text generated always as (case when unit_id is null then 'main' else 'unit' end) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text,
  -- MATCH SIMPLE (the default) skips the check when any column is NULL, so a main meter passes
  -- while a unit meter is proven to sit in this meter's own property.
  foreign key (unit_id, property_id) references app.unit (id, property_id),
  -- 'removed' and a removal date are the same fact; storing both invites them to disagree.
  constraint utility_meter_removed_chk check ((status = 'removed') = (removed_at is not null))
);

-- A meter number is issued by the provider and does not repeat within one office and utility.
create unique index if not exists utility_meter_number_uq
  on app.utility_meter (org_id, utility_type, meter_number) where deleted_at is null;
create index if not exists utility_meter_property_idx
  on app.utility_meter (org_id, property_id) where deleted_at is null;
create index if not exists utility_meter_unit_idx
  on app.utility_meter (unit_id) where unit_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Readings. is_reset is what makes the consumption rule decidable — see §3 of the design note.
-- ---------------------------------------------------------------------------
create table if not exists app.utility_reading (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organization(id) on delete cascade,
  meter_id       uuid not null references app.utility_meter(id) on delete cascade,
  reading_date   date not null,
  value          numeric(14,3) not null check (value >= 0),
  -- "The meter was replaced and restarted at zero." The ONLY way a lower reading is ever treated
  -- as legitimate, and it has to be said explicitly by a person.
  is_reset       boolean not null default false,
  note           text,
  created_by     uuid references app.identity(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text,
  unique (meter_id, reading_date)
);

create index if not exists utility_reading_meter_idx
  on app.utility_reading (meter_id, reading_date desc) where deleted_at is null;

-- current_date is STABLE, not IMMUTABLE, so a future-date rule cannot live in a CHECK constraint.
create or replace function app.tg_utility_reading_guard() returns trigger
language plpgsql as $$
begin
  if new.reading_date > current_date then
    raise exception 'READING_IN_FUTURE: a meter cannot be read on a date that has not happened'
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

drop trigger if exists utility_reading_guard on app.utility_reading;
create trigger utility_reading_guard before insert or update on app.utility_reading
  for each row execute function app.tg_utility_reading_guard();

-- ---------------------------------------------------------------------------
-- 4. Bills.
-- No payment_status column: "paid" is paid_at being set, and "overdue" is unpaid past its due date.
-- A column that stores what can be derived drifts away from it.
-- ---------------------------------------------------------------------------
create table if not exists app.utility_bill (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references app.organization(id) on delete cascade,
  meter_id           uuid not null references app.utility_meter(id) on delete cascade,
  billing_month      date not null,
  previous_reading   numeric(14,3),
  current_reading    numeric(14,3),
  amount_halalas     bigint not null default 0 check (amount_halalas >= 0),
  vat_halalas        bigint not null default 0 check (vat_halalas >= 0),
  other_fees_halalas bigint not null default 0 check (other_fees_halalas >= 0),
  total_halalas      bigint generated always as (amount_halalas + vat_halalas + other_fees_halalas) stored,
  -- Same four-branch rule as readings, applied within one row (both readings are on the bill).
  consumption        numeric(14,3) generated always as (
                       case when previous_reading is null or current_reading is null then null
                            when current_reading >= previous_reading then current_reading - previous_reading
                            else null end) stored,
  needs_review       boolean generated always as (
                       previous_reading is not null and current_reading is not null
                       and current_reading < previous_reading) stored,
  due_date           date,
  paid_at            date,
  notes              text,
  created_by         uuid references app.identity(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid,
  deleted_reason     text,
  -- A billing month is a month, not a day inside one. Storing the 14th would silently split a
  -- month in two for every report that groups by it.
  constraint utility_bill_month_chk check (billing_month = date_trunc('month', billing_month)::date)
);

create unique index if not exists utility_bill_month_uq
  on app.utility_bill (meter_id, billing_month) where deleted_at is null;
create index if not exists utility_bill_org_month_idx
  on app.utility_bill (org_id, billing_month desc) where deleted_at is null;
create index if not exists utility_bill_due_idx
  on app.utility_bill (org_id, due_date) where paid_at is null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 5. updated_at, RLS and grants. Property-scoped, exactly like app.contract: a member restricted to
-- certain properties must not see meters belonging to the others.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['utility_meter', 'utility_reading', 'utility_bill'] loop
    execute format('drop trigger if exists %I_set_updated_at on app.%I;', t, t);
    execute format('create trigger %I_set_updated_at before update on app.%I
                      for each row execute function app.set_updated_at();', t, t);
    execute format('alter table app.%I enable row level security;', t);
    execute format('grant select, insert, update on app.%I to authenticated;', t);
  end loop;
end $$;

drop policy if exists utility_meter_all on app.utility_meter;
create policy utility_meter_all on app.utility_meter for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

-- Readings and bills hang off a meter, so their scope is the meter's scope. Re-deriving the
-- property here would let the two drift apart the day a meter moves.
drop policy if exists utility_reading_all on app.utility_reading;
create policy utility_reading_all on app.utility_reading for all
  using (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)))
  with check (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)));

drop policy if exists utility_bill_all on app.utility_bill;
create policy utility_bill_all on app.utility_bill for all
  using (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)))
  with check (exists (select 1 from app.utility_meter m
                  where m.id = meter_id and app.has_property_access(m.org_id, m.property_id)));

-- ---------------------------------------------------------------------------
-- 6. Consumption, derived. §3 of the design note in four branches.
--
-- security_invoker is not optional here: without it a view runs with its OWNER's rights and hands
-- every office's readings to every caller, bypassing the policies above entirely.
-- ---------------------------------------------------------------------------
create or replace view app.utility_consumption
with (security_invoker = true) as
select
  r.id, r.org_id, r.meter_id, r.reading_date, r.value, r.is_reset, r.note, r.created_at,
  lag(r.value) over w as previous_value,
  case
    -- A replaced meter restarted at zero, so the reading IS the usage since.
    when r.is_reset                              then r.value
    -- No earlier reading: this is a BASELINE. We do not know where the meter started.
    when lag(r.value) over w is null             then null
    when r.value >= lag(r.value) over w          then r.value - lag(r.value) over w
    -- Lower than the last one and not declared a reset. We refuse to guess — see below.
    else null
  end as consumption,
  (not r.is_reset
   and lag(r.value) over w is not null
   and r.value < lag(r.value) over w) as needs_review
from app.utility_reading r
where r.deleted_at is null
window w as (partition by r.meter_id order by r.reading_date);

-- Why the last branch refuses instead of assuming a rollover: a digital meter has five or six
-- digits, so wrapping needs consumption no dwelling produces, while a lower reading is nearly
-- always a typo or an unrecorded meter swap. Computing (max - previous) + current would turn a
-- typing mistake into a plausible-looking bill — worse than a blank, because a blank gets noticed
-- and a plausible number does not.

-- ---------------------------------------------------------------------------
-- 7. Who bears each bill, derived. §4 of the design note.
-- ---------------------------------------------------------------------------
create or replace view app.utility_bill_view
with (security_invoker = true) as
select
  b.id, b.org_id, b.meter_id, b.billing_month, b.previous_reading, b.current_reading,
  b.consumption, b.needs_review, b.amount_halalas, b.vat_halalas, b.other_fees_halalas,
  b.total_halalas, b.due_date, b.paid_at, b.notes, b.created_at,
  m.utility_type, m.meter_number, m.meter_level, m.property_id, m.unit_id,
  p.name  as property_name,
  u.unit_number,
  (b.paid_at is not null)                                        as is_paid,
  (b.paid_at is null and b.due_date is not null
   and b.due_date < current_date)                                 as is_overdue,
  -- A main meter, or a unit standing empty that month, falls to the owner.
  case when c.tenant_party_id is not null then 'tenant' else 'owner' end as bearer_kind,
  coalesce(c.tenant_party_id, op.id)                              as bearer_party_id,
  coalesce(c.tenant_name, op.display_name)                         as bearer_name,
  c.contract_id,
  coalesce(c.overlapping > 1, false)                               as bearer_ambiguous
from app.utility_bill b
join app.utility_meter m on m.id = b.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
left join app.owner o    on o.id = p.owner_id
left join app.party op   on op.id = o.party_id
-- The contract in force on the LAST DAY of the billed month — not today. A bill for March belongs
-- to March's tenant even after they have moved out; resolving against "now" would hand the new
-- tenant their predecessor's bills.
left join lateral (
  select ct.id as contract_id, tp.id as tenant_party_id, tp.display_name as tenant_name,
         count(*) over () as overlapping
    from app.contract ct
    join app.tenant tn on tn.id = ct.tenant_id
    join app.party  tp on tp.id = tn.party_id
   where m.unit_id is not null
     and ct.unit_id = m.unit_id
     and ct.deleted_at is null
     and ct.status <> 'cancelled'
     and ct.start_date <= (b.billing_month + interval '1 month - 1 day')::date
     and ct.end_date   >= (b.billing_month + interval '1 month - 1 day')::date
   order by ct.start_date desc
   limit 1
) c on true
where b.deleted_at is null;

grant select on app.utility_consumption, app.utility_bill_view to authenticated;

-- ================================================================
-- 0064_utility_reports.sql
-- ================================================================
-- 0064_utility_reports.sql
-- Utilities module, phase U-4: the two reports the API cannot express on its own.
--
-- Reports 1 and 2 (bills due, bills overdue) are filters on app.utility_bill_view and need nothing
-- here. Reports 3 and 4 do:
--   * Monthly consumption is a GROUP BY, and PostgREST cannot aggregate.
--   * "Meters needing attention" is a union of four anti-joins across four tables, which no
--     combination of query parameters can express either.
-- Both are views, not tables: nothing below stores a fact that could fall out of date with the
-- readings, bills and contracts it is computed from.
--
-- No new table, no column, no change to anything that exists. Purely additive.

-- ---------------------------------------------------------------------------
-- 1. Report 3 — monthly consumption per meter.
-- Consumption belongs to the month the meter was READ in, which is how a provider bills it.
-- ---------------------------------------------------------------------------
create or replace view app.utility_monthly_consumption
with (security_invoker = true) as
select
  c.org_id,
  c.meter_id,
  m.property_id,
  m.unit_id,
  m.utility_type,
  m.meter_number,
  m.meter_level,
  p.name as property_name,
  u.unit_number,
  date_trunc('month', c.reading_date)::date as month,
  -- NULL consumptions are skipped by sum(), so a month of nothing but baseline or flagged readings
  -- totals NULL rather than zero. Zero would read as "used nothing"; NULL reads as "not known",
  -- which is what it is.
  sum(c.consumption)                                      as consumption,
  count(*)                                                as reading_count,
  count(*) filter (where c.consumption is null)           as unknown_readings,
  count(*) filter (where c.needs_review)                  as flagged_readings
from app.utility_consumption c
join app.utility_meter m on m.id = c.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
where m.deleted_at is null
group by c.org_id, c.meter_id, m.property_id, m.unit_id, m.utility_type, m.meter_number,
         m.meter_level, p.name, u.unit_number, date_trunc('month', c.reading_date);

-- ---------------------------------------------------------------------------
-- 2. Report 4 — meters needing attention.
--
-- The original "unlinked meters" report lost its meaning once meter_level became derived: a meter
-- with no unit IS a main meter, which is a correct state and not a defect. Every row below is
-- instead something a human has to go and do.
-- ---------------------------------------------------------------------------
create or replace view app.utility_attention
with (security_invoker = true) as

-- (a) An active meter nobody has read for two months, or ever. Two months is deliberately longer
-- than a monthly billing cycle, so a single late reading is not treated as neglect.
select
  m.org_id, m.property_id, m.id as meter_id, m.unit_id,
  'stale_reading'::text                as kind,
  m.utility_type, m.meter_number,
  p.name as property_name, u.unit_number,
  max(r.reading_date)                  as ref_date
from app.utility_meter m
join app.property p       on p.id = m.property_id
left join app.unit u      on u.id = m.unit_id
left join app.utility_reading r on r.meter_id = m.id and r.deleted_at is null
where m.deleted_at is null and m.status = 'active'
group by m.org_id, m.property_id, m.id, m.unit_id, m.utility_type, m.meter_number, p.name, u.unit_number
having max(r.reading_date) is null or max(r.reading_date) < current_date - 60

union all

-- (b) A bill with nothing behind it: no reading typed on the bill AND no reading recorded for that
-- meter inside the billed month. A bill that carries its own readings is backed, even without a
-- separate reading row — flagging those would bury the real cases in noise.
select
  b.org_id, m.property_id, m.id, m.unit_id,
  'bill_without_reading'::text,
  m.utility_type, m.meter_number,
  p.name, u.unit_number,
  b.billing_month
from app.utility_bill b
join app.utility_meter m on m.id = b.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
where b.deleted_at is null and m.deleted_at is null
  and b.current_reading is null
  and not exists (
    select 1 from app.utility_reading r
     where r.meter_id = b.meter_id and r.deleted_at is null
       and r.reading_date >= b.billing_month
       and r.reading_date <  (b.billing_month + interval '1 month')::date
  )

union all

-- (c) A rented unit with no meter of its own. Meters are optional by design, so this is a prompt,
-- not an error: an office that bills utilities per unit wants to know which tenant it cannot.
-- A 'removed' meter does not count as coverage; an archived ('inactive') one does, since the meter
-- is still there.
select
  un.org_id, un.property_id, null::uuid, un.id,
  'rented_unit_without_meter'::text,
  null::text, null::text,
  p.name, un.unit_number,
  null::date
from app.unit un
join app.property p on p.id = un.property_id
where un.deleted_at is null and un.current_status = 'rented'
  and not exists (
    select 1 from app.utility_meter m
     where m.unit_id = un.id and m.deleted_at is null and m.status <> 'removed'
  )

union all

-- (d) A reading flagged lower-than-previous that nobody has resolved. This is the loose end the
-- consumption rule deliberately leaves: the system refuses to guess, so a person must answer.
select
  c.org_id, m.property_id, m.id, m.unit_id,
  'reading_needs_review'::text,
  m.utility_type, m.meter_number,
  p.name, u.unit_number,
  c.reading_date
from app.utility_consumption c
join app.utility_meter m on m.id = c.meter_id
join app.property p      on p.id = m.property_id
left join app.unit u     on u.id = m.unit_id
where m.deleted_at is null and c.needs_review;

-- security_invoker on both views is what keeps a property-scoped member from reading another
-- property's meters through a report. Without it each view would run as its owner and answer
-- everything.
grant select on app.utility_monthly_consumption, app.utility_attention to authenticated;

-- ================================================================
-- 0065_entity_notes.sql
-- ================================================================
-- 0065_entity_notes.sql
-- Internal notes on the persistent entities (§6.1 of the design system): tenant, owner, property.
--
-- "Append-only, authored, internal" — one implementation reused by all three, never a per-module
-- variant. A note records what an office decided or observed; editing one later would let the
-- record disagree with what was actually known at the time, which is the whole reason to keep it.
--
-- Not attached to contracts, invoices or receipts: those are documents, not persistent entities.
-- A correction to a document is a document (an amendment, a credit note), not a note.

-- ---------------------------------------------------------------------------
-- 1. Additive unique keys so a note can be tied to a parent AND to that parent's org in one
-- foreign key. Same technique as 0063: the database proves a note cannot be attached to an entity
-- belonging to a different office, rather than a trigger or the application promising it.
-- ---------------------------------------------------------------------------
alter table app.tenant   drop constraint if exists tenant_id_org_uq;
alter table app.tenant   add  constraint tenant_id_org_uq   unique (id, org_id);
alter table app.owner    drop constraint if exists owner_id_org_uq;
alter table app.owner    add  constraint owner_id_org_uq    unique (id, org_id);
alter table app.property drop constraint if exists property_id_org_uq;
alter table app.property add  constraint property_id_org_uq unique (id, org_id);

-- ---------------------------------------------------------------------------
-- 2. The note.
-- ---------------------------------------------------------------------------
create table if not exists app.entity_note (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references app.organization(id) on delete cascade,

  -- Exactly one of these is set. Three nullable columns with real foreign keys beat one
  -- (entity_type, entity_id) pair: a polymorphic pair cannot be a foreign key at all, so nothing
  -- would stop a note pointing at a row that no longer exists.
  tenant_id   uuid,
  owner_id    uuid,
  property_id uuid,

  body        text not null check (length(btrim(body)) > 0),

  -- Stamped by the trigger below from the session, never taken from the request.
  created_by  uuid references app.identity(id),
  created_at  timestamptz not null default now(),

  -- PDPL: a note is free text an office typed about a person, so it can carry personal data and
  -- must be reachable by erasure. These record that it happened rather than deleting the row,
  -- keeping the note's position in the timeline honest.
  redacted_at     timestamptz,
  redacted_reason text,

  constraint entity_note_one_target check (
    (tenant_id is not null)::int + (owner_id is not null)::int + (property_id is not null)::int = 1
  ),
  foreign key (tenant_id, org_id)   references app.tenant   (id, org_id) on delete cascade,
  foreign key (owner_id, org_id)    references app.owner    (id, org_id) on delete cascade,
  foreign key (property_id, org_id) references app.property (id, org_id) on delete cascade
);

create index if not exists entity_note_tenant_idx   on app.entity_note (tenant_id, created_at desc) where tenant_id is not null;
create index if not exists entity_note_owner_idx    on app.entity_note (owner_id, created_at desc) where owner_id is not null;
create index if not exists entity_note_property_idx on app.entity_note (property_id, created_at desc) where property_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Authorship comes from the session, not the payload.
-- ---------------------------------------------------------------------------
create or replace function app.tg_entity_note_author() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  -- A signed-in caller always authors as themselves; a claimed author in the request is discarded.
  -- When there is no session (seeding, an import running as a privileged role) the supplied value
  -- stands, because there is no one to attribute it to.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists entity_note_author on app.entity_note;
create trigger entity_note_author before insert on app.entity_note
  for each row execute function app.tg_entity_note_author();

-- ---------------------------------------------------------------------------
-- 4. Append-only, for users.
--
-- Unlike app.audit_log, this one is not absolute: PDPL erasure has to be able to redact a note's
-- body, and purging an organization has to be able to delete its rows. Both of those run as a
-- privileged role inside a SECURITY DEFINER function. What must never happen is a member editing
-- or deleting a note, and the role test is what forbids exactly that.
--
-- Note the 0053 rule applies to the grants below: `revoke ... from public` would NOT close this,
-- because 0001 sets default privileges for authenticated. The protection here is that UPDATE and
-- DELETE are never granted, with this trigger as the belt if that ever changes by accident.
-- ---------------------------------------------------------------------------
create or replace function app.tg_entity_note_immutable() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'NOTE_APPEND_ONLY: a note cannot be edited or deleted once written'
      using errcode = 'raise_exception';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists entity_note_immutable on app.entity_note;
create trigger entity_note_immutable before update or delete on app.entity_note
  for each row execute function app.tg_entity_note_immutable();

-- ---------------------------------------------------------------------------
-- 5. RLS — each note inherits the scope of the thing it is attached to. A member restricted to
-- certain properties must not read notes on the others, exactly as they cannot read the property.
-- ---------------------------------------------------------------------------
alter table app.entity_note enable row level security;
grant select, insert on app.entity_note to authenticated;

create policy entity_note_read on app.entity_note for select
  using (
    case when property_id is not null
         then app.has_property_access(org_id, property_id)
         else app.has_org_access(org_id) end
  );

create policy entity_note_write on app.entity_note for insert
  with check (
    case when property_id is not null
         then app.has_property_access(org_id, property_id)
         else app.has_org_access(org_id) end
  );

-- ---------------------------------------------------------------------------
-- 6. Erasure reaches the notes. Without this, a party could be erased everywhere else while a note
-- naming them stayed readable — which would make the erasure a claim rather than a fact.
-- ---------------------------------------------------------------------------
create or replace function app.erase_party_notes(p_org uuid, p_party uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  affected integer;
begin
  update app.entity_note n
     set body = '[محذوف بطلب صاحب البيانات]',
         redacted_at = now(),
         redacted_reason = p_reason
   where n.org_id = p_org
     and n.redacted_at is null
     and (
       n.tenant_id in (select t.id from app.tenant t where t.org_id = p_org and t.party_id = p_party)
       or
       n.owner_id  in (select o.id from app.owner  o where o.org_id = p_org and o.party_id = p_party)
     );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- SECURITY DEFINER with no authorization check of its own, so it must not be callable by a member.
-- Per the 0053 rule this has to name both roles: revoking from public would leave the default
-- privileges granted in 0001 untouched.
revoke all on function app.erase_party_notes(uuid, uuid, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Re-emit app.erase_party so the erasure includes the notes. Copied from 0061 with one added
-- call and the count reported back, so an office can tell the data subject exactly what went.
-- ---------------------------------------------------------------------------
create or replace function app.erase_party(p_org uuid, p_party uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_active int;
  v_invoices int;
  v_notes int;
begin
  if not app.is_org_admin(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if not exists (select 1 from app.party where id = p_party and org_id = p_org) then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  -- A live tenancy is a contract in force. Erasing the counterparty to a running lease is not a
  -- privacy request the office can grant; end the contract first.
  select count(*) into v_active
    from app.contract c join app.tenant t on t.id = c.tenant_id
   where c.org_id = p_org and t.party_id = p_party and c.status = 'active' and c.deleted_at is null;
  if v_active > 0 then
    raise exception 'ERASE_ACTIVE_CONTRACT: % active contract(s) reference this party', v_active
      using errcode = 'raise_exception';
  end if;

  select count(*) into v_invoices from app.invoice where org_id = p_org and buyer_party_id = p_party;

  update app.party
     set display_name   = 'بيانات محذوفة',
         national_id    = null, iqama_id = null, passport_no = null,
         cr_number      = null, vat_number = null, unified_number = null, cr_expiry = null,
         phone_e164     = null, phone_raw = null, email = null,
         rep_name       = null, rep_id_number = null, rep_capacity = null,
         rep_phone_e164 = null, rep_phone_raw = null,
         id_exempt_reason = null,
         -- Unlink the portal login so the erased record can never be signed into again.
         identity_id    = null,
         erased_at      = now(),
         erased_reason  = p_reason
   where id = p_party;

  -- The signing representative recorded on each contract is personal data too. These columns sit
  -- outside tg_contract_immutable's frozen set (0042), so an activated contract keeps its legal
  -- and financial terms while the person's details go.
  update app.contract c
     set representative_name = null, representative_capacity = null,
         representative_id   = null, representative_phone = null
    from app.tenant t
   where t.id = c.tenant_id and t.party_id = p_party and c.org_id = p_org;

  update app.trade_name set deleted_at = now(), deleted_reason = 'pdpl_erasure'
   where party_id = p_party and deleted_at is null;

  -- Internal notes are free text an office typed about this person (0065).
  v_notes := app.erase_party_notes(p_org, p_party, p_reason);

  perform app.write_audit(p_org, 'pdpl.erase_party', 'party', p_party,
                          jsonb_build_object('reason', p_reason, 'invoices_retained', v_invoices,
                                             'notes_redacted', v_notes));

  -- Reported, not hidden: the office has to be able to tell the data subject what was kept and why.
  return jsonb_build_object('erased', true, 'invoices_retained', v_invoices,
                            'notes_redacted', v_notes);
end;
$$;

-- ================================================================
-- 0066_org_profile.sql
-- ================================================================
-- 0066_org_profile.sql
-- The organization's own profile: legal identity, national address, collection bank account, logo.
--
-- Why this matters more than it looks: app.issue_invoice (0023) copies org.name / org.vat_number /
-- org.cr_number onto every invoice as the SUPPLIER identity, and four printed documents render them
-- (contract, receipt, owner statement, owner remittance). Until now NOTHING in the product ever
-- wrote those two columns — no screen, no RPC — so every office was printing documents with an
-- empty tax identity. This migration is the storage half of the screen that fills them.
--
-- Every column is ADDITIVE (nullable, no default) — no data loss, no existing query touched. Like
-- org_type, these are PRESENTATION / identity fields: no RLS, trigger, or VAT logic may branch on
-- them (§2 / هـ).

-- ---------------------------------------------------------------------------
-- Legal identity + contact
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists fal_license_no text;  -- رقم ترخيص فال (الهيئة العامة للعقار)
alter table app.organization add column if not exists contact_phone  text;  -- هاتف المكتب كما يُطبع
alter table app.organization add column if not exists contact_email  text;

-- ---------------------------------------------------------------------------
-- Saudi National Address (العنوان الوطني). Kept as its six official parts rather than one free-text
-- line because that is the shape every official document — and a ZATCA standard tax invoice — asks
-- for. A single line cannot be split back apart later.
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists address_building_no   text;  -- رقم المبنى (4)
alter table app.organization add column if not exists address_street        text;  -- الشارع
alter table app.organization add column if not exists address_district      text;  -- الحي
alter table app.organization add column if not exists address_city          text;  -- المدينة
alter table app.organization add column if not exists address_postal_code   text;  -- الرمز البريدي (5)
alter table app.organization add column if not exists address_additional_no text;  -- الرقم الإضافي (4)

-- ---------------------------------------------------------------------------
-- Collection bank account — the office's own account, printed on invoices/statements so a tenant
-- knows where to transfer. NOT an owner's account (that lives on app.owner.iban) and never a
-- destination this system pays out to: nothing here initiates a transfer.
-- ---------------------------------------------------------------------------
alter table app.organization add column if not exists bank_name         text;
alter table app.organization add column if not exists iban              text;
alter table app.organization add column if not exists bank_account_name text;

-- Path inside the private 'org-assets' bucket. Never a URL: the file is streamed through our own
-- origin (/api/org/logo) so the page needs no third-party img-src and the bucket stays private.
alter table app.organization add column if not exists logo_path text;

-- ---------------------------------------------------------------------------
-- Format checks.
--
-- The NEW columns get plain checks — they start out NULL everywhere, so there is nothing to scan.
-- cr_number and vat_number already existed, and this file cannot see what a live database put in
-- them, so those two are added NOT VALID: every INSERT and UPDATE from now on is checked, while a
-- legacy row is left alone. Once the live data is known to be clean:
--   alter table app.organization validate constraint organization_vat_number_chk;
-- ---------------------------------------------------------------------------
do $do$
begin
  -- Saudi VAT number: 15 digits, first and last are 3.
  if not exists (select 1 from pg_constraint where conname = 'organization_vat_number_chk') then
    alter table app.organization add constraint organization_vat_number_chk
      check (vat_number is null or vat_number ~ '^3[0-9]{13}3$') not valid;
  end if;

  -- Commercial registration: 10 digits.
  if not exists (select 1 from pg_constraint where conname = 'organization_cr_number_chk') then
    alter table app.organization add constraint organization_cr_number_chk
      check (cr_number is null or cr_number ~ '^[0-9]{10}$') not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_iban_chk') then
    alter table app.organization add constraint organization_iban_chk
      check (iban is null or iban ~ '^SA[0-9]{22}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_address_chk') then
    alter table app.organization add constraint organization_address_chk
      check (
            (address_building_no   is null or address_building_no   ~ '^[0-9]{4}$')
        and (address_postal_code   is null or address_postal_code   ~ '^[0-9]{5}$')
        and (address_additional_no is null or address_additional_no ~ '^[0-9]{4}$')
      );
  end if;

  -- فال licence numbers are numeric but their length has changed over the years; only the shape is
  -- asserted, not a length nobody can promise.
  if not exists (select 1 from pg_constraint where conname = 'organization_fal_chk') then
    alter table app.organization add constraint organization_fal_chk
      check (fal_license_no is null or fal_license_no ~ '^[0-9]{4,20}$');
  end if;
end
$do$;

comment on column app.organization.vat_number is
  'الرقم الضريبي — copied onto each invoice as supplier_vat_number at issue time (0023). Changing it does not rewrite issued invoices, by design.';
comment on column app.organization.logo_path is
  'Object path inside the private org-assets bucket. Served through /api/org/logo, never as a public URL.';

-- ---------------------------------------------------------------------------
-- Audit. The organization row is editable by any org admin (policy organization_update, 0012), and
-- three of its columns become the supplier identity on legal documents. A change to them has to be
-- attributable afterwards, so the audit is written by a trigger rather than by the caller: it then
-- covers every path into the table, including ones written after this file.
-- ---------------------------------------------------------------------------
create or replace function app.tg_org_profile_audit() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  changed text[];
begin
  select array_agg(n.key order by n.key) into changed
  from jsonb_each(to_jsonb(new)) as n(key, value)
  where n.value is distinct from (to_jsonb(old) -> n.key)
    and n.key <> 'updated_at';

  if changed is null then
    return new;
  end if;

  -- Field NAMES for everything, but the previous VALUE only for the tax identity. That is the part a
  -- dispute is ever about ("this invoice carries a number we no longer use"), and logging the rest
  -- would copy the office's bank details into a second table for no one's benefit.
  perform app.write_audit(
    new.id, 'org.profile_update', 'organization', new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'fields',     to_jsonb(changed),
      'name_from',  case when new.name      is distinct from old.name      then old.name      end,
      'cr_from',    case when new.cr_number is distinct from old.cr_number then old.cr_number end,
      'vat_from',   case when new.vat_number is distinct from old.vat_number then old.vat_number end
    ))
  );
  return new;
end;
$$;

drop trigger if exists org_profile_audit on app.organization;
create trigger org_profile_audit
  after update on app.organization
  for each row execute function app.tg_org_profile_audit();

-- ---------------------------------------------------------------------------
-- Keep app.identity.email in step with auth.users.
--
-- 0017/0037 provision the profile on INSERT and nothing has watched UPDATE since. A user who changes
-- their e-mail address goes through Supabase Auth (confirmation link, then auth.users.email flips) —
-- and app.identity.email kept the old value forever. Nothing broke loudly, which is why it survived:
-- the stale address is simply where notifications would have gone.
--
-- Only email and phone are synced. full_name is ours to own: it is edited in the app, not in GoTrue.
-- ---------------------------------------------------------------------------
create or replace function app.sync_identity_from_auth() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text;
begin
  v_phone := app.normalize_phone_e164(new.phone);
  update app.identity i
     set email      = coalesce(new.email, i.email),
         phone_e164 = coalesce(v_phone, i.phone_e164),
         phone_raw  = coalesce(new.phone, i.phone_raw),
         updated_at = now()
   where i.id = new.id
     and (new.email is distinct from i.email or v_phone is distinct from i.phone_e164);
  return new;
end;
$$;

do $do$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    execute 'drop trigger if exists on_auth_user_updated on auth.users';
    execute 'create trigger on_auth_user_updated
               after update of email, phone on auth.users
               for each row execute function app.sync_identity_from_auth()';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- Logo storage.
--
-- Private bucket, one folder per organization: org-assets/<org_id>/logo.<ext>. The org id in the
-- path is what the policies below prove against, so a member of office A cannot read — let alone
-- overwrite — the logo of office B by guessing a path.
--
-- Supabase-safe / CI-safe: the storage schema only exists on Supabase. On the bare Postgres used by
-- the local test harness this whole block is skipped, exactly like the auth binding in 0017.
-- ---------------------------------------------------------------------------

-- storage.foldername() returns the path segments as text; the first one is only a uuid if we put it
-- there. A cast on a hand-crafted path would raise instead of denying, and a policy that errors is
-- a policy that leaks the fact it errored.
create or replace function app.uuid_or_null(p text) returns uuid
language plpgsql immutable strict as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

do $do$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('org-assets', 'org-assets', false, 524288, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set
    public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists org_assets_read   on storage.objects';
  execute 'drop policy if exists org_assets_write  on storage.objects';
  execute 'drop policy if exists org_assets_update on storage.objects';
  execute 'drop policy if exists org_assets_delete on storage.objects';

  -- Reading is for any member of that org (the logo appears on screens a viewer can open).
  execute $p$
    create policy org_assets_read on storage.objects for select to authenticated
    using (
      bucket_id = 'org-assets'
      and app.is_member_of(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;

  -- Writing is admins only — the logo goes on documents that leave the office.
  execute $p$
    create policy org_assets_write on storage.objects for insert to authenticated
    with check (
      bucket_id = 'org-assets'
      and app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;

  execute $p$
    create policy org_assets_update on storage.objects for update to authenticated
    using (
      bucket_id = 'org-assets'
      and app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;

  execute $p$
    create policy org_assets_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'org-assets'
      and app.is_org_admin(app.uuid_or_null((storage.foldername(name))[1]))
    )$p$;
end
$do$;

-- ================================================================
-- 0067_archive_guards.sql
-- ================================================================
-- 0067_archive_guards.sql
-- "Delete" in this product has always meant soft-delete: set deleted_at, keep the row, keep the
-- history. What it never did was ask whether anything still depended on the row.
--
-- app.deleteProperty soft-deleted a property with active contracts and units without a word. The
-- contracts stayed alive, pointing at a property that no longer appeared anywhere — no error, no
-- warning, and no way for the office to notice until a number stopped adding up.
--
-- This file makes the refusal explicit. It is a data-integrity rail, not an authorization boundary:
-- RLS decides WHO may archive, this decides WHETHER the row is ready to be archived. The message
-- carries counts so the screen can say what is in the way instead of just "no".

-- ---------------------------------------------------------------------------
-- The one legitimate cascade: import_revert undoes a whole committed batch, and walks the rows it
-- created in no particular order — so it will reach a property before that property's units. It
-- announces itself with a transaction-local flag, the same shape as app.allow_org_purge (0061).
--
-- Unlike the purge flag this one does NOT require a non-authenticated role, because import_revert
-- is SECURITY INVOKER and genuinely runs as `authenticated`. It is still not something a client can
-- set: PostgREST exposes only functions in the `app` schema, and set_config is not one of them.
-- ---------------------------------------------------------------------------
create or replace function app.archive_cascade_in_progress() returns boolean
language sql stable set search_path = app, pg_temp as $$
  select coalesce(current_setting('app.allow_cascade_archive', true), '') = 'on';
$$;

-- ---------------------------------------------------------------------------
-- The guard. One function for five tables; it only reacts to the null → timestamp transition of
-- deleted_at, so ordinary edits (and un-archiving) pass straight through.
--
-- The message is structured — HAS_DEPENDENTS:units=3;contracts=2 — because the office needs to read
-- "٣ وحدات وعقدان" in Arabic, and a prose message in English cannot be turned back into that.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: the counts must be the TRUTH, not the caller's view of it. A member
-- scoped to a subset of properties would otherwise count zero contracts on a property whose
-- contracts RLS hides from them, and the guard would wave through exactly the orphaning it exists
-- to prevent. It leaks nothing either way — the only thing it can report is how many rows hang off
-- a row the caller is already permitted to archive.
create or replace function app.tg_block_archive_with_dependents() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  n_units     int;
  n_contracts int;
  n_props     int;
begin
  -- Not an archive: either it was already archived, or deleted_at is being cleared/left alone.
  if old.deleted_at is not null or new.deleted_at is null then
    return new;
  end if;

  if app.archive_cascade_in_progress() then
    return new;
  end if;

  case tg_table_name
    when 'property' then
      select count(*) into n_units     from app.unit     where property_id = old.id and deleted_at is null;
      select count(*) into n_contracts from app.contract where property_id = old.id and deleted_at is null;
      if n_units > 0 or n_contracts > 0 then
        raise exception 'HAS_DEPENDENTS:units=%;contracts=%', n_units, n_contracts
          using errcode = 'raise_exception';
      end if;

    when 'unit' then
      select count(*) into n_contracts from app.contract where unit_id = old.id and deleted_at is null;
      if n_contracts > 0 then
        raise exception 'HAS_DEPENDENTS:contracts=%', n_contracts using errcode = 'raise_exception';
      end if;

    when 'tenant' then
      select count(*) into n_contracts from app.contract where tenant_id = old.id and deleted_at is null;
      if n_contracts > 0 then
        raise exception 'HAS_DEPENDENTS:contracts=%', n_contracts using errcode = 'raise_exception';
      end if;

    when 'owner' then
      -- The self-owner is created with the organization (0013) and is what issue_invoice reads the
      -- supplier identity from for owned properties. Archiving it breaks invoicing silently, and no
      -- office ever means to: it is not a client, it is the office itself.
      if old.is_self then
        raise exception 'SELF_OWNER_UNDELETABLE' using errcode = 'raise_exception';
      end if;
      select count(*) into n_props from app.property where owner_id = old.id and deleted_at is null;
      if n_props > 0 then
        raise exception 'HAS_DEPENDENTS:properties=%', n_props using errcode = 'raise_exception';
      end if;

    when 'contract' then
      -- An ACTIVE contract is a live obligation with a charge schedule behind it and a unit marked
      -- rented in front of it. The way out is an early-termination amendment (0027), which settles
      -- both; archiving would leave the schedule running and the unit occupied forever.
      if old.status = 'active' then
        raise exception 'CONTRACT_ACTIVE_ARCHIVE' using errcode = 'raise_exception';
      end if;

    else
      null;
  end case;

  return new;
end;
$$;

drop trigger if exists block_archive_with_dependents on app.property;
create trigger block_archive_with_dependents before update on app.property
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.unit;
create trigger block_archive_with_dependents before update on app.unit
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.tenant;
create trigger block_archive_with_dependents before update on app.tenant
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.owner;
create trigger block_archive_with_dependents before update on app.owner
  for each row execute function app.tg_block_archive_with_dependents();

drop trigger if exists block_archive_with_dependents on app.contract;
create trigger block_archive_with_dependents before update on app.contract
  for each row execute function app.tg_block_archive_with_dependents();

-- ---------------------------------------------------------------------------
-- import_revert, re-emitted unchanged except for the flag. Undoing a whole batch is the one place
-- where archiving a parent before its children is correct rather than a mistake.
-- ---------------------------------------------------------------------------
create or replace function app.import_revert(p_batch uuid, p_reason text default 'import_revert') returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org uuid;
  r     app.import_row;
begin
  select org_id into v_org from app.import_batch where id = p_batch and status = 'committed';
  if v_org is null then
    raise exception 'IMPORT_NOT_COMMITTED' using errcode = 'raise_exception';
  end if;

  -- Transaction-local: it lapses at commit, so it cannot leak into a later statement.
  perform set_config('app.allow_cascade_archive', 'on', true);

  for r in select * from app.import_row where batch_id = p_batch and created_entity_id is not null loop
    execute format(
      'update app.%I set deleted_at = now(), deleted_by = %L, deleted_reason = %L where id = %L',
      r.created_entity_type, auth.uid(), p_reason, r.created_entity_id);
  end loop;

  perform set_config('app.allow_cascade_archive', 'off', true);

  update app.import_batch set status = 'reverted', reverted_at = now(), reverted_by = auth.uid()
    where id = p_batch;
  perform app.write_audit(v_org, 'import.revert', 'import_batch', p_batch, '{}'::jsonb);
end;
$$;

-- No revoke on archive_cascade_in_progress: per the 0053 rule a `revoke ... from public` would be
-- theatre anyway (0001 grants execute to anon/authenticated by default privilege), and there is
-- nothing here to close — it reports one boolean about the caller's own session setting.
grant execute on function app.import_revert(uuid, text) to authenticated, service_role;

-- ================================================================
-- 0068_migration_ledger.sql
-- ================================================================
-- 0068_migration_ledger.sql
-- A record of which migrations this database actually has.
--
-- Sixty-seven migrations were applied by hand, and the only record of which ones landed was a list
-- in CHANGELOG.md maintained from memory. That list said 0029 was applied. It was not — and nothing
-- noticed for months, because the dashboard call that would have failed loudly (`my_tenant_links`)
-- has its error discarded, so a missing migration looked exactly like a tenant with no portal.
--
-- From here on, every migration records itself in its last line. Nobody has to remember.

create table if not exists app.schema_migration (
  version     text primary key,                       -- '0068'
  name        text not null,                          -- '0068_migration_ledger'
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user,
  -- true for 0001–0067: we inferred these from the objects they left behind, so applied_at is the
  -- moment we looked, not the moment they ran. The distinction matters when reading this table as
  -- history rather than as an inventory.
  backfilled  boolean not null default false,
  -- false where a migration only REPLACES function bodies and leaves no new object to probe for.
  -- Recorded honestly rather than dressed up: "we could not check this one" is information.
  verified    boolean not null default true
);

comment on table app.schema_migration is
  'Which migrations this database has. Written by app.record_migration() from the last line of each migration file.';

alter table app.schema_migration enable row level security;
-- No policy on purpose: nothing reads this through PostgREST. Which migrations are missing is a map
-- of which guards are missing, so it is read only through the operator-gated function below.
revoke all on app.schema_migration from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_migration — the one line every future migration ends with.
-- ---------------------------------------------------------------------------
create or replace function app.record_migration(p_version text, p_name text)
returns void
language sql
set search_path = app, pg_temp as $$
  insert into app.schema_migration (version, name)
  values (p_version, p_name)
  on conflict (version) do update set name = excluded.name, applied_at = now(), applied_by = current_user;
$$;

-- 0053 rule: 0001 grants execute on every app function to anon and authenticated by default, so
-- `revoke from public` closes nothing. This one writes to the ledger and has no internal check —
-- it must be revoked by name or any signed-in user could forge a migration record.
revoke all on function app.record_migration(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- migration_status — what the database has. Operators only.
-- ---------------------------------------------------------------------------
create or replace function app.migration_status()
returns table (version text, name text, applied_at timestamptz, backfilled boolean, verified boolean)
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if not app.is_platform_operator() then
    raise exception 'FORBIDDEN: platform operators only' using errcode = 'raise_exception';
  end if;
  return query
    select m.version, m.name, m.applied_at, m.backfilled, m.verified
    from app.schema_migration m
    order by m.version;
end;
$$;

revoke all on function app.migration_status() from public, anon;
grant execute on function app.migration_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Probe helpers. Existence is checked BY NAME, not by signature: `to_regprocedure` needs the exact
-- argument list, and a probe that fails because someone added a default parameter would report a
-- migration missing when it is present — the one thing this table must never do.
-- ---------------------------------------------------------------------------
create or replace function app.has_app_function(p_name text) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = p_name
  );
$$;

create or replace function app.has_app_column(p_table text, p_column text) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = p_table and column_name = p_column
  );
$$;

-- ---------------------------------------------------------------------------
-- Backfill 0001–0067 by looking at the schema, not by trusting a list.
--
-- Each row carries a boolean SQL expression that is true when that migration's work is present. A
-- migration whose probe fails is NOT recorded — it shows up as missing, which is the entire point.
-- Four rows carry a null probe: they only replace function bodies and leave nothing new behind, so
-- no probe can distinguish "applied" from "not applied". Those are recorded unverified.
-- ---------------------------------------------------------------------------
do $backfill$
declare
  r        record;
  v_ok     boolean;
  v_probed int := 0;
  v_found  int := 0;
  v_assumed int := 0;
begin
  for r in
    select * from (values
      ('0001', '0001_extensions_roles',        $p$to_regnamespace('app') is not null and exists (select 1 from pg_extension where extname = 'pgcrypto')$p$),
      ('0002', '0002_enums',                   $p$to_regtype('app.org_type') is not null$p$),
      ('0003', '0003_utils',                   $p$app.has_app_function('fold_digits')$p$),
      ('0004', '0004_identity_auth',           $p$to_regclass('app.identity') is not null$p$),
      ('0005', '0005_org_membership',          $p$to_regclass('app.organization') is not null$p$),
      ('0006', '0006_party_property',          $p$to_regclass('app.party') is not null$p$),
      ('0007', '0007_contracts_agreements',    $p$to_regclass('app.contract') is not null$p$),
      ('0008', '0008_charges_payments',        $p$to_regclass('app.charge') is not null$p$),
      ('0009', '0009_documents_audit',         $p$to_regclass('app.audit_log') is not null$p$),
      ('0010', '0010_import_staging',          $p$to_regclass('app.import_batch') is not null$p$),
      ('0011', '0011_access_functions',        $p$app.has_app_function('has_org_access')$p$),
      ('0012', '0012_rls_policies',            $p$exists (select 1 from pg_policies where schemaname = 'app' and tablename = 'organization' and policyname = 'organization_select')$p$),
      ('0013', '0013_triggers_guards',         $p$app.has_app_function('write_audit')$p$),
      -- 0014 built the phone-OTP tables and functions; 0032 dropped every one of them. Nothing it
      -- created still exists to probe for, and its absence is indistinguishable from success.
      ('0014', '0014_auth_otp',                null),
      ('0015', '0015_financial_views',         $p$to_regclass('app.charge_balance') is not null$p$),
      ('0016', '0016_import_functions',        $p$app.has_app_function('import_commit')$p$),
      ('0017', '0017_identity_auth_users',     $p$app.has_app_function('handle_new_auth_user')$p$),
      ('0018', '0018_org_visibility',          $p$app.has_app_function('is_member_of')$p$),
      ('0019', '0019_contract_ops',            $p$app.has_app_function('activate_contract')$p$),
      ('0020', '0020_owner_statement',         $p$app.has_app_function('owner_statement')$p$),
      ('0021', '0021_dashboard_kpis',          $p$app.has_app_function('dashboard_finance')$p$),
      ('0022', '0022_receipt_vouchers',        $p$to_regclass('app.org_counter') is not null$p$),
      ('0023', '0023_tax_invoice',             $p$to_regclass('app.invoice') is not null$p$),
      ('0024', '0024_credit_debit_notes',      $p$app.has_app_function('issue_credit_note')$p$),
      ('0025', '0025_owner_remittance',        $p$to_regclass('app.owner_remittance') is not null$p$),
      ('0026', '0026_member_invitations',      $p$app.has_app_function('org_members')$p$),
      ('0027', '0027_contract_amendments',     $p$app.has_app_function('contract_period_shape')$p$),
      ('0028', '0028_owner_portal',            $p$app.has_app_function('owner_is_mine')$p$),
      ('0029', '0029_tenant_portal',           $p$app.has_app_function('tenant_is_mine')$p$),
      ('0030', '0030_portal_documents',        $p$app.has_app_function('tenant_portal_receipt')$p$),
      ('0031', '0031_contract_renewal',        $p$app.has_app_function('renew_contract')$p$),
      -- 0032 is a demolition: it is applied when the things it removed are gone.
      ('0032', '0032_drop_legacy_otp',         $p$not app.has_app_function('otp_pepper') and to_regclass('app.otp_challenge') is null$p$),
      ('0033', '0033_viewer_readonly',         $p$app.has_app_function('is_org_writer')$p$),
      ('0034', '0034_notifications',           $p$to_regclass('app.notification') is not null$p$),
      ('0035', '0035_search_indexes',          $p$to_regclass('app.property_name_trgm') is not null$p$),
      ('0036', '0036_subscription',            $p$to_regclass('app.plan') is not null$p$),
      -- 0037 replaces 0017's function, so the function alone proves nothing. Its constraint does.
      ('0037', '0037_identity_email',          $p$exists (select 1 from pg_constraint where conname = 'identity_contact_present')$p$),
      ('0038', '0038_notification_delivery',   $p$to_regclass('app.notification_delivery') is not null$p$),
      ('0039', '0039_subscription_payments',   $p$to_regclass('app.subscription_payment') is not null$p$),
      ('0040', '0040_recurring_billing',       $p$to_regclass('app.org_payment_method') is not null$p$),
      ('0041', '0041_roles_matrix',            $p$to_regclass('app.role_capability') is not null$p$),
      ('0042', '0042_tenant_establishment',    $p$app.has_app_column('party', 'vat_number')$p$),
      ('0043', '0043_payment_method_ejar',     $p$exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'payment_method' and e.enumlabel = 'ejar')$p$),
      -- 0044 also replaces create_organization; the column is the part only it adds.
      ('0044', '0044_property_fields',         $p$app.has_app_column('property', 'holding_type')$p$),
      ('0045', '0045_contract_numbering_ejar', $p$app.has_app_function('tg_assign_contract_no')$p$),
      -- 0046 only re-emits normalize_amount_halalas and normalize_date, both of which 0003 already
      -- created. Nothing new exists to look for.
      ('0046', '0046_import_parse_hardening',  null),
      ('0047', '0047_import_validate_hardening', $p$app.has_app_function('normalize_decimal')$p$),
      ('0048', '0048_platform_foundation',     $p$to_regclass('app.subscription_event') is not null$p$),
      ('0049', '0049_platform_kpis',           $p$app.has_app_function('platform_kpis')$p$),
      ('0050', '0050_platform_tenant_360',     $p$app.has_app_function('platform_identity_activity')$p$),
      ('0051', '0051_platform_billing',        $p$app.has_app_function('operator_upsert_plan')$p$),
      ('0052', '0052_platform_health_audit',   $p$to_regclass('app.cron_run') is not null$p$),
      -- 0053 took privileges away. It is applied when they are gone.
      ('0053', '0053_service_role_only_grants', $p$to_regprocedure('app.subscription_active(uuid)') is not null and not has_function_privilege('authenticated', 'app.subscription_active(uuid)', 'execute')$p$),
      ('0054', '0054_platform_settings_flags_broadcast', $p$to_regclass('app.platform_setting') is not null$p$),
      -- 0055 and 0056 only re-emit functions 0054 and 0052 had already created.
      ('0055', '0055_platform_fixes',          null),
      ('0056', '0056_alerts_limit_scan',       null),
      ('0057', '0057_tenant_identity',         $p$to_regclass('app.trade_name') is not null$p$),
      ('0058', '0058_import_tenant_identity',  $p$app.has_app_function('map_entity_type')$p$),
      ('0059', '0059_notification_sweep',      $p$app.has_app_function('generate_notifications_for')$p$),
      ('0060', '0060_rate_limit',              $p$to_regclass('app.rate_limit') is not null$p$),
      ('0061', '0061_pdpl_export_erasure',     $p$app.has_app_function('erase_party')$p$),
      ('0062', '0062_offline_subscription_payment', $p$app.has_app_function('subscription_bank_details')$p$),
      ('0063', '0063_utilities',               $p$to_regclass('app.utility_meter') is not null$p$),
      ('0064', '0064_utility_reports',         $p$to_regclass('app.utility_monthly_consumption') is not null$p$),
      ('0065', '0065_entity_notes',            $p$to_regclass('app.entity_note') is not null$p$),
      ('0066', '0066_org_profile',             $p$app.has_app_function('tg_org_profile_audit')$p$),
      ('0067', '0067_archive_guards',          $p$app.has_app_function('archive_cascade_in_progress')$p$)
    ) as t(version, name, probe)
  loop
    if r.probe is null then
      insert into app.schema_migration (version, name, backfilled, verified)
      values (r.version, r.name, true, false)
      on conflict (version) do nothing;
      v_assumed := v_assumed + 1;
      continue;
    end if;

    -- The expression is a literal from the list above; nothing here comes from a caller.
    execute 'select ' || r.probe into v_ok;
    v_probed := v_probed + 1;

    if v_ok then
      insert into app.schema_migration (version, name, backfilled, verified)
      values (r.version, r.name, true, true)
      on conflict (version) do nothing;
      v_found := v_found + 1;
    else
      raise notice 'MIGRATION MISSING: % (%) — its objects are not in this database', r.version, r.name;
    end if;
  end loop;

  raise notice 'Ledger backfill: % of % probed migrations found, % recorded unverified.',
    v_found, v_probed, v_assumed;
end
$backfill$;

select app.record_migration('0068', '0068_migration_ledger');

-- ================================================================
-- 0069_email_mfa.sql
-- ================================================================
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

-- ================================================================
-- 0070_email_backlog_expiry.sql
-- ================================================================
-- 0070_email_backlog_expiry.sql
-- حدّ عُمر داخل طابور البريد: الرسالة المتأخّرة كثيراً لا تُرسَل، تُشطب.
--
-- WHY
-- `claim_email_deliveries` (0038) took every pending row, oldest first, with no notion of age. That
-- is right when the drain runs every few minutes and wrong the moment it stops: on 8 Aug 2026 three
-- environment variables turned out to have been wrong since launch, so the drain had NEVER run, and
-- the first successful cron would have begun mailing offices reminders about instalments they paid
-- months ago and contracts that have since been renewed. Correct the day they were written; wrong
-- by the time they arrived.
--
-- **A queue that comes back after an outage must not flood the customer with the past.**
--
-- WHY EXPIRE RATHER THAN SKIP
-- Filtering the stale rows out of the claim alone would leave them `pending` for ever: the drain
-- would ignore them, and the "بريد بانتظار الإرسال" gauge on /platform/health would keep counting
-- deliveries that are never going to happen. A number nobody can act on is worse than no number.
-- So the claim expires them explicitly, and the queue depth goes back to meaning what it says.
--
-- WHAT IS AND IS NOT LOST
-- Only the DELIVERY is abandoned. The notification itself stays in app.notification and the office
-- still sees it in the app — this drops the e-mail about it, not the fact.

-- ---------------------------------------------------------------------------
-- claim_email_deliveries — same contract, two changes: stale rows are retired first, and the claim
-- itself will not pick up anything older than the window.
-- ---------------------------------------------------------------------------
create or replace function app.claim_email_deliveries(p_max int default 25)
returns setof app.notification_delivery
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  -- Seven days. A due-date reminder is worth sending late; it is not worth sending a week late, and
  -- past that the office has either paid or chased it themselves. Deliberately a constant and not a
  -- parameter: there is no second caller who would pass a different number, and a knob nobody turns
  -- is a knob that goes stale.
  v_max_age constant interval := interval '7 days';
begin
  -- Retire first, so the same run that refuses to send them also stops them being counted as owed.
  update app.notification_delivery
     set status = 'failed',
         last_error = 'expired: older than 7 days when the queue was drained'
   where channel = 'email'
     and status = 'pending'
     and created_at < now() - v_max_age;

  return query
  update app.notification_delivery d
     set attempts        = d.attempts + 1,
         last_attempt_at  = now(),
         next_attempt_at  = now() + (case d.attempts + 1
                                       when 1 then interval '1 minute'
                                       when 2 then interval '5 minutes'
                                       else        interval '30 minutes'
                                     end)
   where d.id in (
     select c.id from app.notification_delivery c
     where c.channel = 'email' and c.status = 'pending'
       and c.next_attempt_at <= now() and c.attempts < c.max_attempts
       -- Belt and braces with the expiry above: a row that crosses the line between the two
       -- statements in a long-running drain must not slip through.
       and c.created_at >= now() - v_max_age
     order by c.created_at
     for update skip locked
     limit greatest(p_max, 0)
   )
  returning d.*;
end;
$$;

-- Grants re-stated: `create or replace` keeps the old ones, but 0053's lesson is that a function's
-- reachability should be readable in the migration that last touched it rather than three files back.
revoke all on function app.claim_email_deliveries(int) from public, anon, authenticated;
grant execute on function app.claim_email_deliveries(int) to service_role;

select app.record_migration('0070', '0070_email_backlog_expiry');

-- ================================================================
-- 0071_mfa_recovery.sql
-- ================================================================
-- 0071_mfa_recovery.sql
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

select app.record_migration('0071', '0071_mfa_recovery');

-- ================================================================
-- 0072_maintenance.sql
-- ================================================================
-- 0072_maintenance.sql
-- طلبات الصيانة — the first thing in this product a TENANT may write.
--
-- Until now the tenant portal was read-only: a tenant could see their contracts, charges and
-- receipts, and nothing they did changed a row. A maintenance request breaks that, so the entry
-- point is deliberately narrow — ONE security-definer function that proves the tenant has an active
-- contract on the unit before it inserts. There is no `for insert` policy for tenants on the table
-- itself, because a policy is a door that a later, looser policy can widen by accident.
--
-- What this file does NOT do, on purpose:
--   * No vendor table. "شركة الصفا للصيانة" is text. A vendor table drags in their contracts,
--     price lists and ratings — a second module inside the first — and it should be extracted from
--     real names later, not guessed at now.
--   * cost_bearer records WHO pays; it posts nothing. Charging an owner for a repair touches the
--     management fee and the owner statement, and that is an accounting decision of its own.
--   * The owner portal is untouched. Owners do not see these rows (decision, 14 Aug 2026): their
--     portal answers about money, and opening it onto maintenance opens "why isn't it fixed yet".
--
-- A request is never deleted. `cancelled` carries a reason, because the row is the record of a
-- tenant's complaint and deleting it erases what the office may later be asked about.

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'maintenance_status' and typnamespace = 'app'::regnamespace) then
    create type app.maintenance_status as enum ('open', 'in_progress', 'resolved', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'maintenance_urgency' and typnamespace = 'app'::regnamespace) then
    create type app.maintenance_urgency as enum ('normal', 'urgent', 'emergency');
  end if;
  -- Who bears the cost. Recorded, not posted.
  if not exists (select 1 from pg_type where typname = 'maintenance_cost_bearer' and typnamespace = 'app'::regnamespace) then
    create type app.maintenance_cost_bearer as enum ('owner', 'tenant', 'office');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The table
-- ---------------------------------------------------------------------------
-- unit_id is NOT NULL: a fault happens in a unit, and the unit names its property. A request
-- floating at property level would have no tenant to answer and no scope to be filtered by.
create table if not exists app.maintenance_request (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references app.organization(id) on delete cascade,
  property_id            uuid not null references app.property(id)     on delete cascade,
  unit_id                uuid not null references app.unit(id)         on delete cascade,
  request_no             text,                                   -- MR-YYYY-NNNNN, assigned by trigger
  request_seq            bigint,

  -- Who reported it. A tenant usually; an employee when the office spots it first, and then the
  -- party is null rather than invented.
  reported_by_party_id   uuid references app.party(id) on delete set null,
  reported_by_identity   uuid,                                   -- the signed-in user, tenant or staff

  category               text not null default 'other'
                           check (category in ('plumbing','electrical','hvac','carpentry','appliance','other')),
  urgency                app.maintenance_urgency not null default 'normal',
  status                 app.maintenance_status  not null default 'open',
  description            text not null check (btrim(description) <> ''),

  -- Free text on purpose (see the header). Both may be empty while the request is still unassigned.
  assignee_name          text,
  vendor_name            text,

  estimated_cost_halalas bigint check (estimated_cost_halalas is null or estimated_cost_halalas >= 0),
  actual_cost_halalas    bigint check (actual_cost_halalas    is null or actual_cost_halalas    >= 0),
  cost_bearer            app.maintenance_cost_bearer,

  -- Optional (decision, 14 Aug 2026): a fault reported without a photo beats a fault not reported.
  photo_path             text,                                   -- object key inside the org-assets bucket

  resolved_at            timestamptz,
  resolution_note        text,
  cancelled_reason       text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  deleted_by             uuid,
  deleted_reason         text,

  unique (org_id, request_no)
);

create index if not exists maintenance_org_open_idx
  on app.maintenance_request (org_id, created_at desc)
  where status in ('open', 'in_progress') and deleted_at is null;
create index if not exists maintenance_property_idx on app.maintenance_request (property_id);
create index if not exists maintenance_unit_idx     on app.maintenance_request (unit_id);
create index if not exists maintenance_party_idx    on app.maintenance_request (reported_by_party_id);

-- ---------------------------------------------------------------------------
-- 3. Numbering — MR-YYYY-NNNNN, the same gapless per-(org, year) counter as CT/INV/RV/RM
-- ---------------------------------------------------------------------------
create or replace function app.tg_assign_maintenance_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year text;
begin
  if new.request_no is null or btrim(new.request_no) = '' then
    v_year          := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
    new.request_seq := app.next_counter(new.org_id, 'maintenance:' || v_year);
    new.request_no  := 'MR-' || v_year || '-' || lpad(new.request_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_assign_no on app.maintenance_request;
create trigger maintenance_assign_no
  before insert on app.maintenance_request
  for each row execute function app.tg_assign_maintenance_no();

-- resolved_at is stamped by the database, not by the caller: "when did this close" must not depend
-- on a client clock or on an update remembering to set two columns at once.
create or replace function app.tg_maintenance_touch()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
  new.updated_at := now();
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif new.status <> 'resolved' then
    new.resolved_at := null;   -- reopened: the closing time is no longer true
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_touch on app.maintenance_request;
create trigger maintenance_touch
  before update on app.maintenance_request
  for each row execute function app.tg_maintenance_touch();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table app.maintenance_request enable row level security;

-- The office: exactly the gate the units use, so a member confined to certain properties sees the
-- requests of those properties and no others — without this file knowing anything about scoping.
drop policy if exists maintenance_office_all on app.maintenance_request;
create policy maintenance_office_all on app.maintenance_request for all
  using (app.has_property_access(org_id, property_id))
  with check (app.has_property_access(org_id, property_id));

-- The tenant: reads their own requests through the portal. Read only — every tenant write goes
-- through submit_maintenance_request below.
drop policy if exists maintenance_tenant_select on app.maintenance_request;
create policy maintenance_tenant_select on app.maintenance_request for select
  using (
    exists (
      select 1 from app.party p
      where p.id = maintenance_request.reported_by_party_id
        and p.identity_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. The tenant's one write
-- ---------------------------------------------------------------------------
-- Proves three things before inserting, and says which one failed:
--   * the caller is the party they claim to be,
--   * that party has an ACTIVE contract on the unit today,
--   * they have not already filed more than the daily allowance.
--
-- The rate limit is not about abuse alone: without it the form becomes a channel for the same
-- complaint five times, and the office triage queue stops being readable.
create or replace function app.submit_maintenance_request(
  p_unit        uuid,
  p_category    text,
  p_urgency     text,
  p_description text,
  p_photo_path  text default null
)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_party    uuid;
  v_org      uuid;
  v_property uuid;
  v_today    date := (now() at time zone 'Asia/Riyadh')::date;
  v_count    int;
  v_id       uuid;
  v_note     uuid;
begin
  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED' using errcode = 'raise_exception';
  end if;

  -- The active contract is the authorization. A former tenant cannot open requests on a unit they
  -- left, and a tenant of unit A cannot open one on unit B.
  select c.org_id, c.property_id, t.party_id
    into v_org, v_property, v_party
  from app.contract c
  join app.tenant   t on t.id = c.tenant_id
  join app.party    p on p.id = t.party_id
  where c.unit_id = p_unit
    and c.status = 'active'
    and c.deleted_at is null
    and p.identity_id = auth.uid()
  limit 1;

  if v_party is null then
    raise exception 'NO_ACTIVE_CONTRACT' using errcode = 'raise_exception';
  end if;

  select count(*) into v_count
  from app.maintenance_request r
  where r.reported_by_party_id = v_party
    and (r.created_at at time zone 'Asia/Riyadh')::date = v_today
    and r.deleted_at is null;

  if v_count >= 5 then
    raise exception 'DAILY_LIMIT' using errcode = 'raise_exception';
  end if;

  insert into app.maintenance_request (
    org_id, property_id, unit_id, reported_by_party_id, reported_by_identity,
    category, urgency, description, photo_path
  )
  values (
    v_org, v_property, p_unit, v_party, auth.uid(),
    coalesce(nullif(btrim(p_category), ''), 'other'),
    coalesce(nullif(btrim(p_urgency), ''), 'normal')::app.maintenance_urgency,
    btrim(p_description),
    nullif(btrim(p_photo_path), '')
  )
  returning id into v_id;

  -- An urgent or emergency fault must reach a person, not a tab. Normal requests do not notify:
  -- a notification for everything is a notification for nothing.
  if (coalesce(nullif(btrim(p_urgency), ''), 'normal'))::app.maintenance_urgency <> 'normal' then
    insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body)
    select v_org, v_property, 'maintenance_urgent', 'maintenance_request', v_id,
           'طلب صيانة عاجل',
           'وحدة ' || u.unit_number || ' — ' || left(btrim(p_description), 140)
    from app.unit u where u.id = p_unit
    on conflict do nothing
    returning id into v_note;

    -- Decision, 14 Aug 2026: yes, email the office. The channel works as of 11 Aug.
    if v_note is not null then
      perform app.enqueue_notification_email(v_note);
    end if;
  end if;

  perform app.write_audit(v_org, 'maintenance.submit', 'maintenance_request', v_id,
                          jsonb_build_object('unit', p_unit, 'urgency', p_urgency));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. What the tenant reads back
-- ---------------------------------------------------------------------------
-- The office's internal columns are not in this list: cost, bearer, assignee and vendor are how the
-- office runs the job, not what the tenant is owed. Status and dates are.
create or replace function app.tenant_portal_maintenance(p_tenant uuid)
returns table (
  id uuid, request_no text, category text, urgency app.maintenance_urgency,
  status app.maintenance_status, description text, unit_number text,
  created_at timestamptz, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select r.id, r.request_no, r.category, r.urgency, r.status, r.description,
           u.unit_number, r.created_at, r.resolved_at
    from app.maintenance_request r
    join app.unit   u on u.id = r.unit_id
    join app.tenant t on t.party_id = r.reported_by_party_id and t.id = p_tenant
    where r.deleted_at is null
    order by r.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants — the 0053 rule: 0001 granted execute to anon/authenticated by default privilege, so a
-- `revoke from public` would close nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.submit_maintenance_request(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function app.submit_maintenance_request(uuid, text, text, text, text) to authenticated;

revoke all on function app.tenant_portal_maintenance(uuid) from public, anon, authenticated;
grant execute on function app.tenant_portal_maintenance(uuid) to authenticated;

-- next_counter is already revoked from public (0022); the trigger runs as definer of its own.
grant select, insert, update on app.maintenance_request to authenticated;

select app.record_migration('0072', 'maintenance');

-- ================================================================
-- 0073_tenant_portal_units.sql
-- ================================================================
-- 0073_tenant_portal_units.sql
-- One missing read, found while building the portal's maintenance form.
--
-- app.submit_maintenance_request (0072) takes a unit id, and the tenant portal had no way to learn
-- one: tenant_portal_contracts returns the unit NUMBER for display, and RLS on app.unit — rightly —
-- shows a tenant nothing. So the form could name the unit but not identify it.
--
-- This is additive on purpose. Adding a column to tenant_portal_contracts would mean dropping and
-- recreating a function three screens already call, to fix a need only one of them has.
--
-- Active contracts only, which is the same rule submit_maintenance_request enforces: offering a
-- tenant a unit the database will then refuse is a form that exists to be rejected.
create or replace function app.tenant_portal_units(p_tenant uuid)
returns table (unit_id uuid, unit_number text, property_name text)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select distinct u.id, u.unit_number, p.name
    from app.contract c
    join app.unit     u on u.id = c.unit_id
    join app.property p on p.id = c.property_id
    where c.tenant_id = p_tenant
      and c.status = 'active'
      and c.deleted_at is null
    order by p.name, u.unit_number;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default privilege, so a bare
-- `revoke from public` would close nothing. Revoke by name, then grant back deliberately.
revoke all on function app.tenant_portal_units(uuid) from public, anon, authenticated;
grant execute on function app.tenant_portal_units(uuid) to authenticated;

select app.record_migration('0073', 'tenant_portal_units');

-- ================================================================
-- 0074_identity_linking.sql
-- ================================================================
-- 0074_identity_linking.sql
-- Who is allowed to become a party — and nothing else. Scope is deliberately narrow: this file
-- closes an open door. The invitation lifecycle (sent / opened / superseded, resend, revoke) is
-- 0075's job and is not touched here.
--
-- WHY NOW: the tenant portal started accepting writes on 14 Aug (0072). Until then a wrong link
-- leaked reads; now it also writes maintenance requests in someone else's name.
--
-- ---------------------------------------------------------------------------
-- 1. Remove app.link_party_identity — an open path to any party in an org
-- ---------------------------------------------------------------------------
-- It was granted to `authenticated` (0013) and accepted a caller-chosen p_party_id, matching ANY
-- live invitation in that org: it never checked the invitation's kind, never checked that the
-- invitation was addressed to that party, and never checked that the party was still unlinked.
-- So any holder of any live token for an org could bind their login to any owner or tenant in it —
-- and could take over a profile that already belonged to somebody else.
--
-- It is dropped rather than repaired: nothing in the product has ever called it (the only caller
-- was one line in the local test suite, updated with this migration), and
-- app.accept_portal_invitation covers its stated purpose under real checks.
drop function if exists app.link_party_identity(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. The identity channel — an operator setting, not a deployment
-- ---------------------------------------------------------------------------
-- Today the product authenticates tenants by email; SMS has no provider yet (ADR-0001). When one
-- is contracted, the switch must be a value change in the platform console, not a release. So the
-- rule that acceptance is matched against lives here as data.
--
--   email  — the signed-in account's email must equal the invitation's email
--   phone  — the account's phone must equal the invitation's phone
--   either — whichever of the two matches is enough
insert into app.platform_setting (key, value, label_ar) values
  ('portal_identity_channel', '"email"'::jsonb, 'قناة إثبات هوية البوابة (بريد / جوال / أيّهما)')
on conflict (key) do nothing;   -- never reset a value the operator has already chosen

create or replace function app.portal_identity_channel()
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select coalesce(app.setting('portal_identity_channel', '"email"'::jsonb) #>> '{}', 'email');
$$;

-- Known keys only, and known values for this one. An unvalidated setting is how a typo locks every
-- tenant out of the portal.
--
-- NOTE: whether an SMS provider is actually configured cannot be seen from inside the database —
-- it lives in the deployment's environment. The console is where that check belongs, and it is
-- part of 0075's work; this function only refuses values that are not one of the three.
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
    raise exception 'UNKNOWN_SETTING' using errcode = 'raise_exception';
  end if;
  -- Floor of 1, not 0: a zero-day trial provisions an office that is locked out the moment it is
  -- created (0055). Rewriting this function is how that fix nearly got lost.
  if p_key = 'trial_days' and (jsonb_typeof(p_value) <> 'number'
       or (p_value)::text::int < 1 or (p_value)::text::int > 365) then
    raise exception 'INVALID_SETTING' using errcode = 'raise_exception';
  end if;
  if p_key = 'default_plan' and not exists (select 1 from app.plan where code = p_value #>> '{}') then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if p_key = 'portal_identity_channel' and coalesce(p_value #>> '{}', '') not in ('email', 'phone', 'either') then
    raise exception 'INVALID_SETTING' using errcode = 'raise_exception';
  end if;

  update app.platform_setting
     set value = p_value, updated_at = now(), updated_by = auth.uid()
   where key = p_key;

  perform app.write_audit(null, 'platform.setting_update', 'platform_setting', null,
    jsonb_build_object('key', p_key, 'before', v_before, 'after', p_value));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Acceptance, under four conditions
-- ---------------------------------------------------------------------------
-- The contact comparison reads the JWT, not app.identity: an email-only sign-up has no identity
-- row at all (app.identity requires a KSA mobile, so the auth.users trigger skips it). The JWT is
-- what the auth provider actually verified about this session, which is precisely the claim we
-- want to test.
--
-- Both portal kinds stay in one function. Owner links run through here too, and narrowing it to
-- tenant_portal would silently break them — the tightening applies to both, which is what the
-- owner portal deserves anyway.
create or replace function app.accept_portal_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = app, extensions, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_inv     app.invitation;
  v_cur     uuid;
  v_channel text := app.portal_identity_channel();
  -- The claims are read straight from request.jwt.claims rather than through auth.jwt(), which is
  -- the convention this schema already uses (0003, 0069, 0071) and keeps the function testable
  -- outside a Supabase instance.
  v_claims  jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_email   text := lower(nullif(btrim(coalesce(v_claims ->> 'email', '')), ''));
  v_phone   text := app.normalize_phone_e164(nullif(btrim(coalesce(v_claims ->> 'phone', '')), ''));
  v_inv_mail text;
  v_ok_mail boolean;
  v_ok_sms  boolean;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  -- (1) a live PORTAL invitation, and (2) one that names a party.
  select * into v_inv from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null and revoked_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  -- (3) the party must still be free. Re-linking is not acceptance — it is a takeover, and undoing
  -- a link is an office action (app.unlink_party_identity below), never a visitor's.
  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null then
    if v_cur = v_me then
      return v_inv.party_id;   -- already mine: idempotent, the second tab is not an error
    end if;
    raise exception 'ALREADY_LINKED: this profile is already linked to another login' using errcode = 'raise_exception';
  end if;

  -- (4) the account must be the one that was invited.
  v_inv_mail := lower(nullif(btrim(coalesce(v_inv.email, '')), ''));
  v_ok_mail  := v_inv_mail is not null and v_email is not null and v_email = v_inv_mail;
  v_ok_sms   := v_inv.phone_e164 is not null and v_phone is not null and v_phone = v_inv.phone_e164;

  -- A refusal that cannot be acted on is worse than none, so the two causes are named apart: the
  -- invitation carries no address on this channel (the office must fix the record and re-invite),
  -- or it does and this account is not it.
  if v_channel = 'email' and v_inv_mail is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no email address' using errcode = 'raise_exception';
  end if;
  if v_channel = 'phone' and v_inv.phone_e164 is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no phone number' using errcode = 'raise_exception';
  end if;
  if v_channel = 'either' and v_inv_mail is null and v_inv.phone_e164 is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no contact' using errcode = 'raise_exception';
  end if;

  if not (
    (v_channel = 'email'  and v_ok_mail)
    or (v_channel = 'phone'  and v_ok_sms)
    or (v_channel = 'either' and (v_ok_mail or v_ok_sms))
  ) then
    -- Recorded because a mismatch is the signature of a forwarded link, and the office should be
    -- able to see that it happened.
    perform app.write_audit(v_inv.org_id, 'portal.link_refused', 'party', v_inv.party_id,
                            jsonb_build_object('kind', v_inv.kind, 'channel', v_channel));
    raise exception 'CONTACT_MISMATCH: sign in with the account this invitation was sent to'
      using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);
  update app.party set identity_id = v_me where id = v_inv.party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'portal.link', 'party', v_inv.party_id,
                          jsonb_build_object('kind', v_inv.kind, 'channel', v_channel));
  return v_inv.party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Unlinking — the missing office action
-- ---------------------------------------------------------------------------
-- Without this, a profile linked to the wrong account (or to one its owner has lost) can never be
-- re-invited: acceptance refuses a linked party, and nothing in the product could clear the link.
-- Admins only, and the reason is required — an unlink is how a profile changes hands, and "who did
-- this and why" is the whole value of recording it.
create or replace function app.unlink_party_identity(p_party uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org  uuid;
  v_prev uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'raise_exception';
  end if;

  select org_id, identity_id into v_org, v_prev from app.party where id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if v_prev is null then
    return;   -- already unlinked: nothing to undo, and no reason to fail the caller
  end if;

  -- Clearing to NULL is allowed by tg_party_identity_guard, which only gates NULL → value.
  update app.party set identity_id = null where id = p_party;

  perform app.write_audit(v_org, 'portal.unlink', 'party', p_party,
                          jsonb_build_object('previous_identity', v_prev, 'reason', btrim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants — 0053 rule: 0001 grants execute to anon/authenticated by default privilege, so a bare
-- `revoke from public` closes nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.unlink_party_identity(uuid, text) from public, anon, authenticated;
grant execute on function app.unlink_party_identity(uuid, text) to authenticated;

revoke all on function app.portal_identity_channel() from public, anon;
grant execute on function app.portal_identity_channel() to authenticated, service_role;

-- accept_portal_invitation keeps the grants it already had (authenticated): the gate is inside it.

select app.record_migration('0074', 'identity_linking');

-- ================================================================
-- 0075_invitation_lifecycle.sql
-- ================================================================
-- 0075_invitation_lifecycle.sql
-- The portal invitation stops being a token and becomes a thing with a state.
--
-- Before this file the office could create an invitation and then knew nothing: not whether it was
-- sent, not whether it was opened, not whether it still pointed at an address the tenant still uses.
-- The only two facts recorded were "accepted" and "revoked", and both were written by someone else.
--
--   pending ──► sent ──► opened ──► accepted
--      │         │         │
--      └─────────┴─────────┴──► expired  (by date)
--                │
--                ├──► revoked     (the office withdrew it)
--                └──► superseded  (the tenant's email or phone changed)
--
-- 0074 decided WHO may accept. This decides WHAT the office can see and do about it. Sending the
-- message itself is the application's job — this file only records that it happened.

-- ---------------------------------------------------------------------------
-- 1. The state a token carries
-- ---------------------------------------------------------------------------
alter table app.invitation
  add column if not exists sent_at         timestamptz,
  add column if not exists sent_channel    text check (sent_channel is null or sent_channel in ('email', 'sms')),
  -- The address it actually went to, kept apart from invitation.email: the office record may be
  -- edited afterwards, and "where did we send it" must not change when it is.
  add column if not exists sent_to         text,
  add column if not exists opened_at       timestamptz,
  add column if not exists superseded_at   timestamptz,
  add column if not exists superseded_reason text;

-- ---------------------------------------------------------------------------
-- 1b. Retire the duplicates that already exist
-- ---------------------------------------------------------------------------
-- Before this migration nothing stopped a second "رابط البوابة" click from minting another live
-- token, and production has profiles carrying several. The invariant below cannot be declared over
-- data that already breaks it, and the honest repair is the one the new rule implies: the newest
-- token stands, the older ones are retired as superseded.
--
-- Retiring rather than deleting, and superseded rather than revoked: nobody withdrew these — they
-- were replaced. And a token that reaches the office's inbox later should read as "replaced by a
-- newer link", which is what actually happened.
with ranked as (
  select id,
         row_number() over (partition by party_id, kind order by created_at desc, id desc) as rn
  from app.invitation
  where party_id is not null
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null
    and revoked_at is null
    and superseded_at is null
)
update app.invitation i
   set superseded_at = now(),
       superseded_reason = 'replaced_by_newer_invite'
  from ranked r
 where i.id = r.id and r.rn > 1;

-- One live portal invitation per party and kind. Two live tokens double the attack surface for a
-- convenience nobody asked for — resending rotates rather than accumulates.
create unique index if not exists invitation_one_live_portal
  on app.invitation (party_id, kind)
  where party_id is not null
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null
    and revoked_at is null
    and superseded_at is null;

-- ---------------------------------------------------------------------------
-- 2. Changing the contact retires the invitation
-- ---------------------------------------------------------------------------
-- An invitation is addressed to one mailbox or one number. If the office corrects the tenant's email
-- after sending it, the old address still holds a live token — and that address may now belong to
-- somebody else entirely, or may have been the typo that prompted the correction.
--
-- Only PENDING portal invitations are touched. An accepted one is history, and history is not edited.
create or replace function app.tg_party_contact_supersedes_invites()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
  if new.email is distinct from old.email or new.phone_e164 is distinct from old.phone_e164 then
    update app.invitation
       set superseded_at = now(),
           superseded_reason = 'contact_changed'
     where party_id = new.id
       and kind in ('owner_portal', 'tenant_portal')
       and accepted_at is null
       and revoked_at is null
       and superseded_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists party_contact_supersedes_invites on app.party;
create trigger party_contact_supersedes_invites
  after update on app.party
  for each row execute function app.tg_party_contact_supersedes_invites();

-- Acceptance must refuse a superseded token too. 0074 already checks accepted/revoked/expired; this
-- adds the fourth retirement reason without touching anything else in that function.
create or replace function app.accept_portal_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = app, extensions, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_inv     app.invitation;
  v_cur     uuid;
  v_channel text := app.portal_identity_channel();
  v_claims  jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_email   text := lower(nullif(btrim(coalesce(v_claims ->> 'email', '')), ''));
  v_phone   text := app.normalize_phone_e164(nullif(btrim(coalesce(v_claims ->> 'phone', '')), ''));
  v_inv_mail text;
  v_ok_mail boolean;
  v_ok_sms  boolean;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'raise_exception';
  end if;

  select * into v_inv from app.invitation
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and kind in ('owner_portal', 'tenant_portal')
    and accepted_at is null and revoked_at is null and superseded_at is null and expires_at > now()
  limit 1;
  if v_inv.id is null or v_inv.party_id is null then
    raise exception 'INVITATION_INVALID: token not found, expired, or already used' using errcode = 'raise_exception';
  end if;

  select identity_id into v_cur from app.party where id = v_inv.party_id;
  if v_cur is not null then
    if v_cur = v_me then
      return v_inv.party_id;
    end if;
    raise exception 'ALREADY_LINKED: this profile is already linked to another login' using errcode = 'raise_exception';
  end if;

  v_inv_mail := lower(nullif(btrim(coalesce(v_inv.email, '')), ''));
  v_ok_mail  := v_inv_mail is not null and v_email is not null and v_email = v_inv_mail;
  v_ok_sms   := v_inv.phone_e164 is not null and v_phone is not null and v_phone = v_inv.phone_e164;

  if v_channel = 'email' and v_inv_mail is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no email address' using errcode = 'raise_exception';
  end if;
  if v_channel = 'phone' and v_inv.phone_e164 is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no phone number' using errcode = 'raise_exception';
  end if;
  if v_channel = 'either' and v_inv_mail is null and v_inv.phone_e164 is null then
    raise exception 'INVITE_CONTACT_MISSING: invitation has no contact' using errcode = 'raise_exception';
  end if;

  if not (
    (v_channel = 'email'  and v_ok_mail)
    or (v_channel = 'phone'  and v_ok_sms)
    or (v_channel = 'either' and (v_ok_mail or v_ok_sms))
  ) then
    perform app.write_audit(v_inv.org_id, 'portal.link_refused', 'party', v_inv.party_id,
                            jsonb_build_object('kind', v_inv.kind, 'channel', v_channel));
    raise exception 'CONTACT_MISMATCH: sign in with the account this invitation was sent to'
      using errcode = 'raise_exception';
  end if;

  perform set_config('app.allow_party_link', 'on', true);
  update app.party set identity_id = v_me where id = v_inv.party_id;
  perform set_config('app.allow_party_link', '', true);

  update app.invitation set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
  perform app.write_audit(v_inv.org_id, 'portal.link', 'party', v_inv.party_id,
                          jsonb_build_object('kind', v_inv.kind, 'channel', v_channel));
  return v_inv.party_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sent / opened — the two facts the office was missing
-- ---------------------------------------------------------------------------
-- Called by the application right after the message leaves. Deliberately not "mark as sent, hope for
-- the best": the address is stored as it was used, so a later edit of the tenant record cannot
-- rewrite where the message actually went.
create or replace function app.mark_invitation_sent(p_invitation uuid, p_channel text, p_to text)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
begin
  if coalesce(p_channel, '') not in ('email', 'sms') then
    raise exception 'INVALID_CHANNEL' using errcode = 'raise_exception';
  end if;
  select org_id into v_org from app.invitation where id = p_invitation;
  if v_org is null then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.invitation
     set sent_at = now(), sent_channel = p_channel, sent_to = nullif(btrim(coalesce(p_to, '')), '')
   where id = p_invitation;

  perform app.write_audit(v_org, 'portal.invite_sent', 'invitation', p_invitation,
                          jsonb_build_object('channel', p_channel));
end;
$$;

-- Stamped when the join page is opened with a live token. First open only: the office wants to know
-- "did it arrive", not how many times the page was refreshed.
--
-- It returns nothing on purpose. A visitor holding a token learns whether it is live from trying to
-- accept it, and this function must not become a way to probe tokens for information.
create or replace function app.mark_invitation_opened(p_token text)
returns void
language plpgsql
security definer
set search_path = app, extensions, pg_temp
as $$
begin
  update app.invitation
     set opened_at = coalesce(opened_at, now())
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and kind in ('owner_portal', 'tenant_portal')
     and accepted_at is null and revoked_at is null and superseded_at is null and expires_at > now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Resend and revoke
-- ---------------------------------------------------------------------------
-- Resending rotates: the live token is retired and a new one issued. Two live tokens for one profile
-- is a wider door for no gain, and "which link did I send you?" is a support call nobody needs.
create or replace function app.resend_portal_invitation(p_party uuid)
returns text
language plpgsql
security definer
set search_path = app, extensions, pg_temp
as $$
declare
  v_org   uuid;
  v_kind  text;
  v_phone text;
  v_email text;
  v_token text;
  v_id    uuid;
begin
  select p.org_id, p.phone_e164, p.email into v_org, v_phone, v_email
  from app.party p where p.id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'NO_CONTACT: add a phone or email to the record first' using errcode = 'raise_exception';
  end if;
  if exists (select 1 from app.party where id = p_party and identity_id is not null) then
    raise exception 'ALREADY_LINKED: unlink the profile before inviting again' using errcode = 'raise_exception';
  end if;

  -- The kind follows what the party already is, so a resend cannot quietly turn an owner invitation
  -- into a tenant one.
  select case when exists (select 1 from app.tenant t where t.party_id = p_party and t.deleted_at is null)
              then 'tenant_portal' else 'owner_portal' end into v_kind;

  update app.invitation
     set revoked_at = now(), revoked_by = auth.uid()
   where party_id = p_party
     and kind in ('owner_portal', 'tenant_portal')
     and accepted_at is null and revoked_at is null and superseded_at is null;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into app.invitation (org_id, party_id, kind, phone_e164, email, token_hash, expires_at, created_by)
  values (v_org, p_party, v_kind, v_phone, v_email,
          encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days', auth.uid())
  returning id into v_id;

  perform app.write_audit(v_org, 'portal.invite_resend', 'party', p_party,
                          jsonb_build_object('invitation', v_id, 'kind', v_kind));
  return v_token;
end;
$$;

create or replace function app.revoke_portal_invitation(p_party uuid, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
  v_n   int;
begin
  select org_id into v_org from app.party where id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.invitation
     set revoked_at = now(), revoked_by = auth.uid()
   where party_id = p_party
     and kind in ('owner_portal', 'tenant_portal')
     and accepted_at is null and revoked_at is null and superseded_at is null;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform app.write_audit(v_org, 'portal.invite_revoke', 'party', p_party,
                            jsonb_build_object('count', v_n, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  end if;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. What the office sees
-- ---------------------------------------------------------------------------
-- One row per party: the state of its portal access, in the order the office reads it.
--
-- The token is never returned — not its hash either. This answers "where does this stand", and the
-- link itself is shown once, at the moment it is created.
create or replace function app.portal_invitation_state(p_party uuid)
returns table (
  state       text,     -- linked | accepted | pending | sent | opened | revoked | superseded | expired | none
  sent_at     timestamptz,
  sent_channel text,
  sent_to     text,
  opened_at   timestamptz,
  expires_at  timestamptz,
  linked      boolean
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
  v_org    uuid;
  v_linked boolean;
begin
  select p.org_id, p.identity_id is not null into v_org, v_linked from app.party p where p.id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.has_org_access(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  return query
    with latest as (
      select i.* from app.invitation i
      where i.party_id = p_party and i.kind in ('owner_portal', 'tenant_portal')
      order by i.created_at desc
      limit 1
    )
    select
      case
        -- The link is the fact that matters; how it was obtained is history.
        when v_linked                       then 'linked'
        when l.id is null                   then 'none'
        when l.accepted_at   is not null    then 'accepted'
        when l.revoked_at    is not null    then 'revoked'
        when l.superseded_at is not null    then 'superseded'
        when l.expires_at    <= now()       then 'expired'
        when l.opened_at     is not null    then 'opened'
        when l.sent_at       is not null    then 'sent'
        else 'pending'
      end,
      l.sent_at, l.sent_channel, l.sent_to, l.opened_at, l.expires_at, v_linked
    from (select 1) one left join latest l on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — 0053 rule: revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.mark_invitation_sent(uuid, text, text)   from public, anon, authenticated;
revoke all on function app.mark_invitation_opened(text)             from public, anon, authenticated;
revoke all on function app.resend_portal_invitation(uuid)           from public, anon, authenticated;
revoke all on function app.revoke_portal_invitation(uuid, text)     from public, anon, authenticated;
revoke all on function app.portal_invitation_state(uuid)            from public, anon, authenticated;

grant execute on function app.mark_invitation_sent(uuid, text, text)   to authenticated;
grant execute on function app.mark_invitation_opened(text)             to authenticated;
grant execute on function app.resend_portal_invitation(uuid)           to authenticated;
grant execute on function app.revoke_portal_invitation(uuid, text)     to authenticated;
grant execute on function app.portal_invitation_state(uuid)            to authenticated;

select app.record_migration('0075', 'invitation_lifecycle');

-- ================================================================
-- 0076_tenant_payment_info.sql
-- ================================================================
-- 0076_tenant_payment_info.sql
-- Where to send the money.
--
-- The tenant portal has always been able to say what is owed and when. It could not say how to pay
-- it: the office's bank details live on app.organization, and RLS — rightly — shows a tenant nothing
-- of that table. So the screen ended at "٩٬٠٠٠ ر.س، متأخرة ٣ أيام" and the tenant phoned to ask for
-- an IBAN that the office had already recorded.
--
-- Three fields and no more: the account name, the bank, and the IBAN. Not the CR number, not the VAT
-- number, not the address or the licence — a tenant paying rent needs none of them, and a portal
-- read is a read by someone outside the office.
create or replace function app.tenant_portal_payment_info(p_tenant uuid)
returns table (org_name text, bank_name text, iban text)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  -- Returns a row only when there is something to act on. A card headed "كيف أدفع" over three
  -- dashes is worse than no card: it tells the tenant the office forgot, in the office's voice.
  return query
    select o.name, o.bank_name, o.iban
    from app.tenant t
    join app.organization o on o.id = t.org_id
    where t.id = p_tenant
      and o.iban is not null
      and o.deleted_at is null;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default privilege, so a bare
-- `revoke from public` closes nothing. Revoke by name, then grant back deliberately.
revoke all on function app.tenant_portal_payment_info(uuid) from public, anon, authenticated;
grant execute on function app.tenant_portal_payment_info(uuid) to authenticated;

select app.record_migration('0076', 'tenant_payment_info');

-- ================================================================
-- 0077_invitation_provider_receipt.sql
-- ================================================================
-- 0077_invitation_provider_receipt.sql
-- The receipt the provider hands back, kept instead of thrown away.
--
-- 0075 taught the office to read "أُرسلت". It did not teach it what that word means: the application
-- writes it when Resend answers 2xx, which is "accepted for delivery", not "in the tenant's inbox".
-- Those two are usually the same and occasionally are not, and the gap is exactly where a tenant says
-- "لم يصلني شيء" while the screen says it was sent.
--
-- Resend answers with a message id and we were discarding it. Keeping it costs one column and turns
-- that argument into a lookup: paste the id into the provider's log and read delivered / bounced /
-- complained. This migration does not make a message arrive — it makes its absence answerable.
alter table app.invitation
  add column if not exists sent_message_id text;

comment on column app.invitation.sent_message_id is
  'The email provider''s id for the message, as returned when it accepted it. Evidence, not state: it
   says the message was handed over, never that it was read.';

-- ---------------------------------------------------------------------------
-- mark_invitation_sent — now records the receipt too
-- ---------------------------------------------------------------------------
-- The 3-argument form is dropped rather than kept alongside: two overloads separated only by a
-- defaulted trailing argument are ambiguous to call, and PostgREST would have to guess.
drop function if exists app.mark_invitation_sent(uuid, text, text);

create or replace function app.mark_invitation_sent(
  p_invitation uuid,
  p_channel    text,
  p_to         text,
  p_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid;
begin
  select i.org_id into v_org from app.invitation i where i.id = p_invitation;
  if v_org is null then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.is_org_admin(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  update app.invitation
     set sent_at         = now(),
         sent_channel    = p_channel,
         sent_to         = nullif(btrim(coalesce(p_to, '')), ''),
         sent_message_id = nullif(btrim(coalesce(p_message_id, '')), '')
   where id = p_invitation;

  -- The id goes into the audit line as well: the invitation row keeps only the latest send, and a
  -- question about a message sent three rotations ago has nowhere else to be answered from.
  perform app.write_audit(v_org, 'portal.invite_sent', 'invitation', p_invitation,
                          jsonb_build_object('channel', p_channel, 'message_id', p_message_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- portal_invitation_state — one more column, so the office never opens a table to find it
-- ---------------------------------------------------------------------------
-- Adding a column to a returns-table demands a drop; create-or-replace cannot change the shape.
drop function if exists app.portal_invitation_state(uuid);

create or replace function app.portal_invitation_state(p_party uuid)
returns table (
  state           text,   -- linked | accepted | pending | sent | opened | revoked | superseded | expired | none
  sent_at         timestamptz,
  sent_channel    text,
  sent_to         text,
  sent_message_id text,
  opened_at       timestamptz,
  expires_at      timestamptz,
  linked          boolean
)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
  v_org    uuid;
  v_linked boolean;
begin
  select p.org_id, p.identity_id is not null into v_org, v_linked from app.party p where p.id = p_party;
  if v_org is null then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'raise_exception';
  end if;
  if not app.has_org_access(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;

  return query
    with latest as (
      select i.* from app.invitation i
      where i.party_id = p_party and i.kind in ('owner_portal', 'tenant_portal')
      order by i.created_at desc
      limit 1
    )
    select
      case
        -- The link is the fact that matters; how it was obtained is history.
        when v_linked                       then 'linked'
        when l.id is null                   then 'none'
        when l.accepted_at   is not null    then 'accepted'
        when l.revoked_at    is not null    then 'revoked'
        when l.superseded_at is not null    then 'superseded'
        when l.expires_at    <= now()       then 'expired'
        when l.opened_at     is not null    then 'opened'
        when l.sent_at       is not null    then 'sent'
        else 'pending'
      end,
      l.sent_at, l.sent_channel, l.sent_to, l.sent_message_id, l.opened_at, l.expires_at, v_linked
    from (select 1) one left join latest l on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public`
-- closes nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on function app.mark_invitation_sent(uuid, text, text, text) from public, anon, authenticated;
revoke all on function app.portal_invitation_state(uuid)                from public, anon, authenticated;

grant execute on function app.mark_invitation_sent(uuid, text, text, text) to authenticated;
grant execute on function app.portal_invitation_state(uuid)                to authenticated;

select app.record_migration('0077', 'invitation_provider_receipt');

-- ================================================================
-- 0078_tenant_notifications.sql
-- ================================================================
-- 0078_tenant_notifications.sql
-- The other half of a maintenance request: telling the person who opened it what happened.
--
-- 0072 gave the tenant a way to report a fault and gave the office a way to work it. Between those
-- two the tenant heard nothing — not when the work started, not when it was closed, not when it was
-- refused. So they reopen the portal each day to check, or they phone the office: the two things the
-- module exists to prevent.
--
-- Everything needed to send is already here — an outbox with idempotency and backoff (0038), a
-- drainer (0059), a provider (8 Aug). What was missing is that a notification has always been an
-- OFFICE object: app.notification is read through has_property_access, and a tenant is not a member,
-- so no row in that table has ever been readable by one. This file makes a notification able to name
-- a person instead of an office, and leaves every existing row exactly as it was.

-- ---------------------------------------------------------------------------
-- 1. Two columns
-- ---------------------------------------------------------------------------
alter table app.notification
  -- NULL means what every row means today: this belongs to the office. Not null means it is addressed
  -- to that party, and the office does not see it — the office is the sender, and its bell should not
  -- ring with its own outgoing mail.
  add column if not exists recipient_party_id uuid references app.party(id) on delete cascade,
  -- Where the message points. The drainer used to hardcode /app/notifications, which is a staff page:
  -- a tenant sent there meets a wall. The producer knows the destination; the drainer should not have
  -- to learn about parties and portals to find it.
  add column if not exists link_path text;

create index if not exists notification_recipient_idx
  on app.notification (recipient_party_id, created_at desc)
  where recipient_party_id is not null;

-- The dedupe index is what makes generation idempotent. It must now separate rows by addressee, or
-- one person's notice would silently suppress another's for the same entity and kind.
drop index if exists app.notification_dedupe;
create unique index if not exists notification_dedupe on app.notification
  (org_id, kind,
   coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(due_date, '0001-01-01'::date),
   coalesce(recipient_party_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- 2. Who reads what
-- ---------------------------------------------------------------------------
-- The office keeps exactly the reach it had, minus rows addressed to someone else.
drop policy if exists notification_select on app.notification;
create policy notification_select on app.notification for select
  using (recipient_party_id is null and app.has_property_access(org_id, property_id));

-- SECURITY DEFINER for the same reason app.tenant_is_mine is (0029): a policy predicate runs as the
-- querying user, and app.party is readable only by members of its org. A tenant asking "is this row
-- mine?" through a plain EXISTS would be answered "no" by a policy hiding their own record — the
-- notice would be addressed to them and invisible to them.
create or replace function app.party_is_mine(p_party uuid)
returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.party p
    where p.id = p_party and p.deleted_at is null and p.identity_id = auth.uid()
  );
$$;

-- And the addressee reads their own, through the same identity link the portal already trusts.
drop policy if exists notification_recipient_select on app.notification;
create policy notification_recipient_select on app.notification for select
  using (recipient_party_id is not null and app.party_is_mine(recipient_party_id));

-- ---------------------------------------------------------------------------
-- 3. Enqueue learns the second shape
-- ---------------------------------------------------------------------------
-- One function, one call site, two audiences. Splitting it into enqueue_office_email and
-- enqueue_party_email would mean every future producer has to know which one it is talking to; the
-- notification already says.
create or replace function app.enqueue_notification_email(p_notification_id uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_party uuid;
begin
  select n.recipient_party_id into v_party from app.notification n where n.id = p_notification_id;

  if v_party is not null then
    -- A party with no email simply gets no row. Silence beats a delivery aimed at nothing, which
    -- would burn three attempts and land in the failure count as if the provider were at fault.
    insert into app.notification_delivery (org_id, notification_id, channel, target)
    select n.org_id, n.id, 'email', p.email
    from app.notification n
    join app.party p on p.id = n.recipient_party_id
    where n.id = p_notification_id
      and p.email is not null
      and btrim(p.email) <> ''
      and p.deleted_at is null
    on conflict (notification_id, channel, target) do nothing;
    return;
  end if;

  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.id = p_notification_id
  on conflict (notification_id, channel, target) do nothing;
end;
$$;

-- The bulk sibling has the same blind spot, and it is the dangerous one: it sweeps every unread
-- notification in the org and mails it to every member. Left alone, the office would receive a copy
-- of every message written to a tenant — signed by the office, addressed to the office.
--
-- Only the `_for` twin is redeclared here. 0059 made the gated names thin wrappers that delegate to
-- these; rewriting a wrapper to hold the query again would silently undo that delegation, which is
-- exactly how 0074 reintroduced a bug by copying from schema_all.sql. The migrations are the source.
create or replace function app.enqueue_email_deliveries_for(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_count int;
begin
  insert into app.notification_delivery (org_id, notification_id, channel, target)
  select n.org_id, n.id, 'email', i.email
  from app.notification n
  join app.membership m on m.org_id = n.org_id and m.status = 'active' and m.deleted_at is null
  join app.identity   i on i.id = m.identity_id and i.email is not null and i.status = 'active'
  where n.org_id = p_org and n.read_at is null and n.recipient_party_id is null
  on conflict (notification_id, channel, target) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- And the unread figure the sweep reports to the health page. The three inserts below are 0059's,
-- unchanged; only the closing count is. An operator gauge that counts messages written TO tenants as
-- office work waiting to be done is a gauge that lies — the same objection 0070 raised about a queue
-- depth padded with rows nobody would ever send.
create or replace function app.generate_notifications_for(p_org uuid) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  -- Charges due within 7 days, not yet settled.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_due_soon', 'charge', c.id,
         'استحقاق قريب', 'دفعة تستحق بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and not cb.is_settled
    and c.due_date >= current_date and c.due_date <= current_date + 7
  on conflict do nothing;

  -- Overdue unsettled charges.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select c.org_id, c.property_id, 'charge_overdue', 'charge', c.id,
         'دفعة متأخرة', 'دفعة متأخرة استحقّت بتاريخ ' || c.due_date, c.due_date
  from app.charge c join app.charge_balance cb on cb.charge_id = c.id
  where c.org_id = p_org and c.deleted_at is null and cb.is_overdue and not cb.is_settled
  on conflict do nothing;

  -- Active contracts ending within 30 days with no successor renewal yet.
  insert into app.notification (org_id, property_id, kind, entity_type, entity_id, title, body, due_date)
  select ct.org_id, ct.property_id, 'contract_expiring', 'contract', ct.id,
         'عقد ينتهي قريباً', 'العقد ' || ct.contract_number || ' ينتهي بتاريخ ' || ct.end_date, ct.end_date
  from app.contract ct
  where ct.org_id = p_org and ct.status = 'active' and ct.deleted_at is null
    and ct.end_date >= current_date and ct.end_date <= current_date + 30
    and not exists (
      select 1 from app.contract r
      where r.renewed_from_contract_id = ct.id and r.deleted_at is null and r.status <> 'cancelled')
  on conflict do nothing;

  return (select count(*)::int from app.notification
           where org_id = p_org and read_at is null and recipient_party_id is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The trigger
-- ---------------------------------------------------------------------------
-- A trigger rather than a line inside the office's action: the status is changed by a plain UPDATE
-- through RLS, so there is no single function to amend, and any future path — an import, a bulk
-- close, a screen not yet written — would have to remember. This cannot be forgotten.
--
-- The resolution note is deliberately NOT sent (decision, 20 Aug 2026). The office has been writing
-- it since 0072 knowing the tenant cannot see it — tenant_portal_maintenance does not return it — so
-- it may well carry what was never written to be read. Publishing it now would change the meaning of
-- a field already filled in confidence.
create or replace function app.tg_maintenance_notify_tenant() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
declare
  v_note   uuid;
  v_tenant uuid;
  v_unit   text;
  v_title  text;
  v_body   text;
begin
  -- Nobody to tell: reported by staff, or the party record was erased under PDPL.
  if new.reported_by_party_id is null then
    return new;
  end if;

  select
    case new.status
      when 'in_progress' then 'بدأ العمل على طلبك'
      when 'resolved'    then 'أُغلق طلبك'
      when 'cancelled'   then 'لم يُقبل طلبك'
    end
  into v_title;

  -- Back to 'open' is an administrative correction, not news. Saying nothing is the right amount.
  if v_title is null then
    return new;
  end if;

  select u.unit_number into v_unit from app.unit u where u.id = new.unit_id;

  -- The portal is addressed by tenant, not by party. A party that is not a tenant of this org has no
  -- portal to point at, and the message goes without a link rather than to a broken one.
  select t.id into v_tenant
  from app.tenant t
  where t.party_id = new.reported_by_party_id
    and t.org_id = new.org_id
    and t.deleted_at is null
  limit 1;

  v_body := 'طلب الصيانة ' || coalesce(new.request_no, '') || ' — وحدة ' || coalesce(v_unit, '')
         || case new.status
              when 'resolved'  then '. إن لم يُعالَج فعلاً فأبلغ المكتب.'
              when 'cancelled' then '. للاستفسار تواصل مع المكتب.'
              else '.'
            end;

  insert into app.notification (
    org_id, property_id, kind, entity_type, entity_id, title, body,
    recipient_party_id, link_path
  )
  values (
    new.org_id, new.property_id, 'maintenance_' || new.status::text,
    'maintenance_request', new.id, v_title, v_body,
    new.reported_by_party_id,
    case when v_tenant is not null then '/portal/tenant/' || v_tenant::text end
  )
  on conflict do nothing
  returning id into v_note;

  -- Null when the same transition was already announced: dedupe did its job, and re-enqueueing would
  -- be a second copy of a message already sent.
  if v_note is not null then
    perform app.enqueue_notification_email(v_note);
  end if;

  return new;
end;
$$;

drop trigger if exists maintenance_notify_tenant on app.maintenance_request;
create trigger maintenance_notify_tenant
  after update of status on app.maintenance_request
  for each row
  when (old.status is distinct from new.status)
  execute function app.tg_maintenance_notify_tenant();

-- ---------------------------------------------------------------------------
-- 5. Grants — 0053 rule: 0001 grants execute by default privilege, so a bare `revoke from public`
-- closes nothing. Revoke by name, then grant back deliberately.
-- ---------------------------------------------------------------------------
-- enqueue stays service_role-only exactly as 0053 left it; the trigger reaches it as DEFINER.
revoke all on function app.enqueue_notification_email(uuid)      from public, anon, authenticated;
revoke all on function app.tg_maintenance_notify_tenant()        from public, anon, authenticated;
revoke all on function app.party_is_mine(uuid)                   from public, anon, authenticated;
grant execute on function app.enqueue_notification_email(uuid)   to service_role;
-- The policy calls it as the querying user, so authenticated must be able to.
grant execute on function app.party_is_mine(uuid)                to authenticated, service_role;

select app.record_migration('0078', 'tenant_notifications');
