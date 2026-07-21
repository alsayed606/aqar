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
