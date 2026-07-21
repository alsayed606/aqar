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
