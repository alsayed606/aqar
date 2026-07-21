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
