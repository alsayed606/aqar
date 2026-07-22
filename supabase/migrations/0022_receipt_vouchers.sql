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
