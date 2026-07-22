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
