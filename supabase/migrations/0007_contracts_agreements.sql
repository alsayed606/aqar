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
