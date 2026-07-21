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
