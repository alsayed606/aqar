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
