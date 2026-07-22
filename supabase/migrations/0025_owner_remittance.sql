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
