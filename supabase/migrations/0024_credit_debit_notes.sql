-- 0024_credit_debit_notes.sql
-- ZATCA credit note (إشعار دائن) and debit note (إشعار مدين). Both are e-invoice documents that
-- REFERENCE a previously issued invoice and carry a reason:
--   * credit note reduces/cancels an invoice (issued in error, early termination, discount, return);
--   * debit note adds an amount to an invoice (extra charge, undercharge correction).
-- A cleared invoice is never edited/deleted — corrections are always a new referencing document.
--
-- These reuse the app.invoice / app.invoice_line tables (a doc_kind discriminator) so numbering,
-- QR, print, and the list all work unchanged. Notes get their own gapless per-(org,year) series:
-- CN-YYYY-NNNNN (credit) and DN-YYYY-NNNNN (debit). Notes carry no charge_id (they reference the
-- original invoice, not a charge), so the one-invoice-per-charge index and re-invoicing are unaffected.

alter table app.invoice add column if not exists doc_kind       text not null default 'invoice';  -- invoice | credit_note | debit_note
alter table app.invoice add column if not exists ref_invoice_id uuid references app.invoice(id);
alter table app.invoice add column if not exists reason         text;

create index if not exists invoice_ref_idx on app.invoice (ref_invoice_id) where ref_invoice_id is not null;

-- ---------------------------------------------------------------------------
-- Numbering: branch the prefix + counter series on doc_kind (invoice series unchanged).
-- ---------------------------------------------------------------------------
create or replace function app.tg_assign_invoice_no()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  v_year   text;
  v_prefix text;
  v_series text;
begin
  if new.invoice_seq is null then
    v_year := to_char((coalesce(new.issue_at, now())) at time zone 'Asia/Riyadh', 'YYYY');
    v_prefix := case new.doc_kind when 'credit_note' then 'CN' when 'debit_note' then 'DN' else 'INV' end;
    v_series := (case new.doc_kind when 'credit_note' then 'creditnote:' when 'debit_note' then 'debitnote:' else 'invoice:' end) || v_year;
    new.invoice_seq := app.next_counter(new.org_id, v_series);
    new.invoice_no  := v_prefix || '-' || v_year || '-' || lpad(new.invoice_seq::text, 5, '0');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- issue_credit_note(invoice, reason) → note id. Full reversal: mirrors the original's lines and
-- totals, references it, and marks the original 'cancelled' (which frees its charge to be re-invoiced).
-- ---------------------------------------------------------------------------
create or replace function app.issue_credit_note(p_invoice uuid, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_temp
as $$
declare
  orig   app.invoice;
  v_note uuid;
begin
  select * into orig from app.invoice where id = p_invoice and deleted_at is null;
  if orig.id is null then raise exception 'INVOICE_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if orig.doc_kind <> 'invoice' then
    raise exception 'NOT_AN_INVOICE: only invoices can be credited' using errcode = 'raise_exception';
  end if;
  if orig.status <> 'issued' then
    raise exception 'INVOICE_NOT_ISSUED: already cancelled/credited' using errcode = 'raise_exception';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'raise_exception';
  end if;

  insert into app.invoice (
    org_id, property_id, contract_id, charge_id, owner_id, buyer_party_id,
    doc_kind, ref_invoice_id, reason, invoice_type, issue_at, supply_date,
    supplier_name, supplier_vat_number, supplier_cr_number, buyer_name, buyer_vat_number, buyer_id,
    total_excl_vat_halalas, total_vat_halalas, total_incl_vat_halalas, created_by
  ) values (
    orig.org_id, orig.property_id, orig.contract_id, null, orig.owner_id, orig.buyer_party_id,
    'credit_note', orig.id, p_reason, orig.invoice_type, now(), orig.supply_date,
    orig.supplier_name, orig.supplier_vat_number, orig.supplier_cr_number, orig.buyer_name, orig.buyer_vat_number, orig.buyer_id,
    orig.total_excl_vat_halalas, orig.total_vat_halalas, orig.total_incl_vat_halalas, auth.uid()
  ) returning id into v_note;

  insert into app.invoice_line (
    org_id, invoice_id, charge_id, description, quantity,
    unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas, line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason
  )
  select org_id, v_note, null, description, quantity,
         unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas, line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason
  from app.invoice_line where invoice_id = orig.id;

  update app.invoice set status = 'cancelled' where id = orig.id;

  perform app.write_audit(orig.org_id, 'invoice.credit_note', 'invoice', v_note,
                          jsonb_build_object('ref', orig.id, 'reason', p_reason));
  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- issue_debit_note(invoice, reason, description, amount_excl, vat_rate) → note id.
-- Adds an amount on top of an invoice. Does NOT change the original's status. vat_rate defaults to
-- the original invoice's line rate when omitted.
-- ---------------------------------------------------------------------------
create or replace function app.issue_debit_note(
  p_invoice uuid, p_reason text, p_desc text, p_amount_excl bigint, p_vat_rate numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_temp
as $$
declare
  orig   app.invoice;
  v_note uuid;
  v_rate numeric(5,4);
  v_vat  bigint;
  v_incl bigint;
begin
  select * into orig from app.invoice where id = p_invoice and deleted_at is null;
  if orig.id is null then raise exception 'INVOICE_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if orig.doc_kind <> 'invoice' then
    raise exception 'NOT_AN_INVOICE: only invoices can be debited' using errcode = 'raise_exception';
  end if;
  if p_amount_excl is null or p_amount_excl <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'raise_exception';
  end if;

  v_rate := coalesce(p_vat_rate,
                     (select vat_rate from app.invoice_line where invoice_id = orig.id order by created_at limit 1),
                     0);
  v_vat  := round(p_amount_excl * v_rate);
  v_incl := p_amount_excl + v_vat;

  insert into app.invoice (
    org_id, property_id, contract_id, charge_id, owner_id, buyer_party_id,
    doc_kind, ref_invoice_id, reason, invoice_type, issue_at, supply_date,
    supplier_name, supplier_vat_number, supplier_cr_number, buyer_name, buyer_vat_number, buyer_id,
    total_excl_vat_halalas, total_vat_halalas, total_incl_vat_halalas, created_by
  ) values (
    orig.org_id, orig.property_id, orig.contract_id, null, orig.owner_id, orig.buyer_party_id,
    'debit_note', orig.id, p_reason, orig.invoice_type, now(), orig.supply_date,
    orig.supplier_name, orig.supplier_vat_number, orig.supplier_cr_number, orig.buyer_name, orig.buyer_vat_number, orig.buyer_id,
    p_amount_excl, v_vat, v_incl, auth.uid()
  ) returning id into v_note;

  insert into app.invoice_line (
    org_id, invoice_id, charge_id, description, quantity,
    unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas, line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason
  ) values (
    orig.org_id, v_note, null, coalesce(nullif(btrim(p_desc), ''), 'مبلغ إضافي'), 1,
    p_amount_excl, v_rate, v_vat, p_amount_excl, v_incl, null
  );

  perform app.write_audit(orig.org_id, 'invoice.debit_note', 'invoice', v_note,
                          jsonb_build_object('ref', orig.id, 'reason', p_reason, 'amount', p_amount_excl));
  return v_note;
end;
$$;

revoke all on function app.issue_credit_note(uuid, text) from public;
revoke all on function app.issue_debit_note(uuid, text, text, bigint, numeric) from public;
grant execute on function app.issue_credit_note(uuid, text) to authenticated, service_role;
grant execute on function app.issue_debit_note(uuid, text, text, bigint, numeric) to authenticated, service_role;
