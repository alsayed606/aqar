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
