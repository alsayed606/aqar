-- 0016_import_functions.sql
-- Excel import: validate (normalize + per-field errors + reference resolution), commit (create
-- entities, stamp what each row created), revert (soft-delete a whole batch). SCHEMA.md §11.
-- SECURITY INVOKER: the caller must be an active member of the batch's org — RLS confines every
-- read/write to that org, and entity creation passes the same WITH CHECK gates as manual entry.

-- ---------- small mappers (Arabic label -> enum) ----------
create or replace function app.map_property_kind(p text) returns app.property_kind
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'سكني' then 'residential' when 'تجاري' then 'commercial'
    when 'مختلط' then 'mixed_use'  when 'أرض' then 'land' when 'ارض' then 'land'
    else 'residential' end::app.property_kind;
$$;

create or replace function app.map_unit_status(p text) returns app.unit_status
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'شاغرة' then 'vacant' when 'مؤجرة' then 'rented' when 'محجوزة' then 'reserved'
    when 'تحت الصيانة' then 'under_maintenance' when 'غير صالحة للتأجير' then 'not_rentable'
    when 'خارج الخدمة' then 'out_of_service' else 'vacant' end::app.unit_status;
$$;

create or replace function app.map_charge_type(p text) returns app.charge_type
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'إيجار سكني' then 'residential_rent' when 'إيجار تجاري' then 'commercial_rent'
    when 'خدمات' then 'service_fee' when 'تأمين' then 'insurance'
    when 'رسوم إدارية' then 'admin_fee' when 'تأمين مسترد' then 'security_deposit'
    else null end::app.charge_type;
$$;

create or replace function app.map_payment_frequency(p text) returns app.payment_frequency
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'شهري' then 'monthly' when 'ربع سنوي' then 'quarterly'
    when 'نصف سنوي' then 'semi_annual' when 'سنوي' then 'annual'
    when 'دفعة واحدة' then 'one_time' else 'quarterly' end::app.payment_frequency;
$$;

create or replace function app.map_legal_kind(p text) returns app.legal_kind
language sql immutable as $$
  select case trim(coalesce(p,''))
    when 'شركة' then 'company' when 'مؤسسة' then 'company' else 'individual' end::app.legal_kind;
$$;

create or replace function app.import_err(p_field text, p_value text, p_reason text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('field', p_field, 'value', p_value, 'reason', p_reason);
$$;

create or replace function app.self_owner_id(p_org uuid) returns uuid
language sql stable as $$
  select id from app.owner where org_id = p_org and is_self and deleted_at is null limit 1;
$$;

-- ===========================================================================
-- import_validate — normalize every row, collect per-field errors, resolve references.
-- ===========================================================================
create or replace function app.import_validate(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  r      app.import_row;
  norm   jsonb;
  errs   jsonb;
  s      text;
  amt    bigint;
  ph     text;
  d1     date;
  d2     date;
  ref_id uuid;
  ref2   uuid;
  n_valid int := 0;
  n_error int := 0;
  n_total int := 0;
begin
  select org_id, kind into v_org, v_kind from app.import_batch where id = p_batch;
  if v_org is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch order by row_number loop
    norm := '{}'::jsonb;
    errs := '[]'::jsonb;
    n_total := n_total + 1;

    if v_kind = 'properties' then
      s := nullif(trim(r.raw->>'اسم العقار'), '');
      if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('name', s); end if;
      norm := norm || jsonb_build_object(
        'property_kind', app.map_property_kind(r.raw->>'نوع العقار'),
        'deed_number',   nullif(trim(r.raw->>'رقم الصك'), ''),
        'city',          nullif(trim(r.raw->>'المدينة'), ''),
        'district',      nullif(trim(r.raw->>'الحي'), ''),
        'address_line',  nullif(trim(r.raw->>'العنوان'), ''),
        'owner_name',    nullif(trim(r.raw->>'اسم المالك'), ''));

    elsif v_kind = 'owners' then
      s := nullif(trim(r.raw->>'الاسم'), '');
      if s is null then errs := errs || app.import_err('الاسم', r.raw->>'الاسم', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('display_name', s); end if;
      ph := r.raw->>'الجوال';
      if ph is not null and trim(ph) <> '' then
        if app.normalize_phone_e164(ph) is null
          then errs := errs || app.import_err('الجوال', ph, 'رقم جوال غير صالح');
          else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(ph), 'phone_raw', ph);
        end if;
      end if;
      norm := norm || jsonb_build_object(
        'legal_kind', app.map_legal_kind(r.raw->>'النوع'),
        'national_id', nullif(trim(r.raw->>'رقم الهوية'), ''),
        'iban', nullif(trim(r.raw->>'الآيبان'), ''),
        'bank_name', nullif(trim(r.raw->>'البنك'), ''));

    elsif v_kind = 'tenants' then
      s := nullif(trim(r.raw->>'الاسم'), '');
      if s is null then errs := errs || app.import_err('الاسم', r.raw->>'الاسم', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('display_name', s); end if;
      ph := coalesce(r.raw->>'الجوال', '');
      if trim(ph) <> '' then
        if app.normalize_phone_e164(ph) is null
          then errs := errs || app.import_err('الجوال', ph, 'رقم جوال غير صالح');
          else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(ph), 'phone_raw', ph);
        end if;
      end if;
      norm := norm || jsonb_build_object(
        'legal_kind', app.map_legal_kind(r.raw->>'النوع'),
        'national_id', nullif(trim(coalesce(r.raw->>'رقم الهوية', r.raw->>'رقم الإقامة')), ''),
        'email', nullif(trim(r.raw->>'البريد الإلكتروني'), ''));

    elsif v_kind = 'units' then
      s := nullif(trim(r.raw->>'اسم العقار'), '');
      if s is null then errs := errs || app.import_err('اسم العقار', r.raw->>'اسم العقار', 'حقل مطلوب');
      else
        select id into ref_id from app.property
          where org_id = v_org and name = s and deleted_at is null limit 1;
        if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود في المنصة');
        else norm := norm || jsonb_build_object('property_id', ref_id); end if;
      end if;
      s := nullif(trim(r.raw->>'رقم الوحدة'), '');
      if s is null then errs := errs || app.import_err('رقم الوحدة', r.raw->>'رقم الوحدة', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('unit_number', s); end if;
      norm := norm || jsonb_build_object(
        'floor', nullif(trim(r.raw->>'الدور'), ''),
        'area_sqm', nullif(app.fold_digits(r.raw->>'المساحة'), ''),
        'current_status', app.map_unit_status(r.raw->>'الحالة'));

    elsif v_kind = 'contracts' then
      s := nullif(trim(r.raw->>'رقم العقد'), '');
      if s is null then errs := errs || app.import_err('رقم العقد', r.raw->>'رقم العقد', 'حقل مطلوب');
      else norm := norm || jsonb_build_object('contract_number', s); end if;
      -- property
      s := nullif(trim(r.raw->>'اسم العقار'), '');
      select id into ref_id from app.property where org_id = v_org and name = s and deleted_at is null limit 1;
      if ref_id is null then errs := errs || app.import_err('اسم العقار', s, 'العقار غير موجود');
      else
        norm := norm || jsonb_build_object('property_id', ref_id);
        -- unit within property
        s := nullif(trim(r.raw->>'رقم الوحدة'), '');
        select id into ref2 from app.unit where property_id = ref_id and unit_number = s and deleted_at is null limit 1;
        if ref2 is null then errs := errs || app.import_err('رقم الوحدة', s, 'الوحدة غير موجودة في هذا العقار');
        else norm := norm || jsonb_build_object('unit_id', ref2); end if;
      end if;
      -- tenant by national id or name
      s := nullif(trim(r.raw->>'رقم هوية المستأجر'), '');
      ref_id := null;
      if s is not null then
        select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
          where t.org_id = v_org and p.national_id = s and t.deleted_at is null limit 1;
      end if;
      if ref_id is null then
        s := nullif(trim(r.raw->>'اسم المستأجر'), '');
        select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
          where t.org_id = v_org and p.display_name = s and t.deleted_at is null limit 1;
      end if;
      if ref_id is null then errs := errs || app.import_err('المستأجر', coalesce(r.raw->>'اسم المستأجر', r.raw->>'رقم هوية المستأجر'), 'المستأجر غير موجود');
      else norm := norm || jsonb_build_object('tenant_id', ref_id); end if;
      -- dates
      d1 := app.normalize_date(r.raw->>'تاريخ البداية');
      d2 := app.normalize_date(r.raw->>'تاريخ النهاية');
      if d1 is null then errs := errs || app.import_err('تاريخ البداية', r.raw->>'تاريخ البداية', 'تاريخ غير صالح');
      else norm := norm || jsonb_build_object('start_date', d1); end if;
      if d2 is null then errs := errs || app.import_err('تاريخ النهاية', r.raw->>'تاريخ النهاية', 'تاريخ غير صالح');
      else norm := norm || jsonb_build_object('end_date', d2); end if;
      if d1 is not null and d2 is not null and d2 < d1 then
        errs := errs || app.import_err('تاريخ النهاية', d2::text, 'تاريخ النهاية قبل البداية');
      end if;
      -- amounts
      amt := app.normalize_amount_halalas(r.raw->>'الإيجار السنوي');
      if amt is null then errs := errs || app.import_err('الإيجار السنوي', r.raw->>'الإيجار السنوي', 'مبلغ غير صالح');
      else norm := norm || jsonb_build_object('annual_rent_halalas', amt); end if;
      norm := norm || jsonb_build_object(
        'deposit_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'التأمين'), 0),
        'service_fees_halalas', coalesce(app.normalize_amount_halalas(r.raw->>'رسوم الخدمات'), 0),
        'payment_frequency', app.map_payment_frequency(r.raw->>'دورية الدفع'),
        'ejar_contract_number', nullif(trim(r.raw->>'رقم عقد إيجار'), ''),
        'deed_number', nullif(trim(r.raw->>'رقم الصك'), ''));

    elsif v_kind = 'charges' then
      s := nullif(trim(r.raw->>'رقم العقد'), '');
      select id into ref_id from app.contract
        where org_id = v_org and contract_number = s and deleted_at is null limit 1;
      if ref_id is null then errs := errs || app.import_err('رقم العقد', s, 'العقد غير موجود');
      else
        norm := norm || jsonb_build_object('contract_id', ref_id);
        norm := norm || (select jsonb_build_object('property_id', property_id, 'unit_id', unit_id)
                         from app.contract where id = ref_id);
      end if;
      if app.map_charge_type(r.raw->>'نوع الاستحقاق') is null then
        errs := errs || app.import_err('نوع الاستحقاق', r.raw->>'نوع الاستحقاق', 'نوع غير معروف');
      else norm := norm || jsonb_build_object('charge_type', app.map_charge_type(r.raw->>'نوع الاستحقاق')); end if;
      d1 := app.normalize_date(r.raw->>'تاريخ الاستحقاق');
      if d1 is null then errs := errs || app.import_err('تاريخ الاستحقاق', r.raw->>'تاريخ الاستحقاق', 'تاريخ غير صالح');
      else norm := norm || jsonb_build_object('due_date', d1); end if;
      amt := app.normalize_amount_halalas(r.raw->>'المبلغ قبل الضريبة');
      if amt is null then errs := errs || app.import_err('المبلغ قبل الضريبة', r.raw->>'المبلغ قبل الضريبة', 'مبلغ غير صالح');
      else
        norm := norm || jsonb_build_object('amount_excl_vat_halalas', amt);
        -- VAT rate defaults to 0 for residential rent; caller may override via 'نسبة الضريبة'
        declare v_rate numeric(5,4) := coalesce(nullif(app.fold_digits(r.raw->>'نسبة الضريبة'), '')::numeric, 0);
        begin
          norm := norm || jsonb_build_object(
            'vat_rate', v_rate,
            'vat_amount_halalas', round(amt * v_rate)::bigint);
        end;
      end if;
      norm := norm || jsonb_build_object('description', nullif(trim(r.raw->>'الوصف'), ''));
    end if;

    update app.import_row
      set normalized = norm, errors = errs, is_valid = (jsonb_array_length(errs) = 0)
      where id = r.id;
    if jsonb_array_length(errs) = 0 then n_valid := n_valid + 1; else n_error := n_error + 1; end if;
  end loop;

  update app.import_batch
    set status = 'validated', total_rows = n_total, valid_rows = n_valid, error_rows = n_error
    where id = p_batch;
end;
$$;

-- ===========================================================================
-- import_commit — insert entities for every VALID row; stamp created_entity for revert.
-- Runs in the caller's transaction; a single failure rolls the whole thing back.
-- ===========================================================================
create or replace function app.import_commit(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  v_status app.import_status;
  r      app.import_row;
  n      jsonb;
  new_id uuid;
  v_party uuid;
  v_owner uuid;
begin
  select org_id, kind, status into v_org, v_kind, v_status from app.import_batch where id = p_batch;
  if v_org is null then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if v_status <> 'validated' then
    raise exception 'IMPORT_NOT_VALIDATED: run import_validate first' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch and is_valid order by row_number loop
    n := r.normalized;

    if v_kind = 'properties' then
      -- resolve owner: explicit owner_name → find-or-create; else self owner
      if coalesce(n->>'owner_name', '') <> '' then
        select o.id into v_owner from app.owner o join app.party p on p.id = o.party_id
          where o.org_id = v_org and p.display_name = n->>'owner_name' and o.deleted_at is null limit 1;
        if v_owner is null then
          insert into app.party (org_id, display_name, roles) values (v_org, n->>'owner_name', array['owner']::app.party_role[])
            returning id into v_party;
          insert into app.owner (org_id, party_id) values (v_org, v_party) returning id into v_owner;
        end if;
      else
        v_owner := app.self_owner_id(v_org);
      end if;
      insert into app.property (org_id, owner_id, name, property_kind, deed_number, city, district, address_line)
      values (v_org, v_owner, n->>'name', (n->>'property_kind')::app.property_kind,
              n->>'deed_number', n->>'city', n->>'district', n->>'address_line')
      returning id into new_id;
      update app.import_row set created_entity_type = 'property', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'owners' then
      insert into app.party (org_id, display_name, legal_kind, national_id, phone_e164, phone_raw, roles)
      values (v_org, n->>'display_name', (n->>'legal_kind')::app.legal_kind, n->>'national_id',
              n->>'phone_e164', n->>'phone_raw', array['owner']::app.party_role[])
      returning id into v_party;
      insert into app.owner (org_id, party_id, owner_kind, iban, bank_name)
      values (v_org, v_party, (n->>'legal_kind')::app.legal_kind, n->>'iban', n->>'bank_name')
      returning id into new_id;
      update app.import_row set created_entity_type = 'owner', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'tenants' then
      insert into app.party (org_id, display_name, legal_kind, national_id, phone_e164, phone_raw, email, roles)
      values (v_org, n->>'display_name', (n->>'legal_kind')::app.legal_kind, n->>'national_id',
              n->>'phone_e164', n->>'phone_raw', (n->>'email')::citext, array['tenant']::app.party_role[])
      returning id into v_party;
      insert into app.tenant (org_id, party_id, tenant_kind)
      values (v_org, v_party, (n->>'legal_kind')::app.legal_kind)
      returning id into new_id;
      update app.import_row set created_entity_type = 'tenant', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'units' then
      insert into app.unit (org_id, property_id, unit_number, floor, area_sqm, current_status)
      values (v_org, (n->>'property_id')::uuid, n->>'unit_number', n->>'floor',
              nullif(n->>'area_sqm', '')::numeric, (n->>'current_status')::app.unit_status)
      returning id into new_id;
      update app.import_row set created_entity_type = 'unit', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'contracts' then
      insert into app.contract (org_id, property_id, unit_id, tenant_id, contract_number,
                                ejar_contract_number, deed_number, start_date, end_date,
                                annual_rent_halalas, payment_frequency, deposit_halalas, service_fees_halalas,
                                status)
      values (v_org, (n->>'property_id')::uuid, (n->>'unit_id')::uuid, (n->>'tenant_id')::uuid,
              n->>'contract_number', n->>'ejar_contract_number', n->>'deed_number',
              (n->>'start_date')::date, (n->>'end_date')::date,
              (n->>'annual_rent_halalas')::bigint, (n->>'payment_frequency')::app.payment_frequency,
              (n->>'deposit_halalas')::bigint, (n->>'service_fees_halalas')::bigint, 'draft')
      returning id into new_id;
      update app.import_row set created_entity_type = 'contract', created_entity_id = new_id where id = r.id;

    elsif v_kind = 'charges' then
      insert into app.charge (org_id, property_id, unit_id, contract_id, charge_type, due_date,
                              amount_excl_vat_halalas, vat_rate, vat_amount_halalas, description)
      values (v_org, (n->>'property_id')::uuid, nullif(n->>'unit_id','')::uuid, (n->>'contract_id')::uuid,
              (n->>'charge_type')::app.charge_type, (n->>'due_date')::date,
              (n->>'amount_excl_vat_halalas')::bigint, (n->>'vat_rate')::numeric,
              (n->>'vat_amount_halalas')::bigint, n->>'description')
      returning id into new_id;
      update app.import_row set created_entity_type = 'charge', created_entity_id = new_id where id = r.id;
    end if;
  end loop;

  update app.import_batch set status = 'committed', committed_at = now() where id = p_batch;
  perform app.write_audit(v_org, 'import.commit', 'import_batch', p_batch,
                          jsonb_build_object('kind', v_kind));
end;
$$;

-- ===========================================================================
-- import_revert — soft-delete everything a committed batch created (whole-batch undo). §11.
-- ===========================================================================
create or replace function app.import_revert(p_batch uuid, p_reason text default 'import_revert') returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org uuid;
  r     app.import_row;
begin
  select org_id into v_org from app.import_batch where id = p_batch and status = 'committed';
  if v_org is null then
    raise exception 'IMPORT_NOT_COMMITTED' using errcode = 'raise_exception';
  end if;

  for r in select * from app.import_row where batch_id = p_batch and created_entity_id is not null loop
    execute format(
      'update app.%I set deleted_at = now(), deleted_by = %L, deleted_reason = %L where id = %L',
      r.created_entity_type, auth.uid(), p_reason, r.created_entity_id);
  end loop;

  update app.import_batch set status = 'reverted', reverted_at = now(), reverted_by = auth.uid()
    where id = p_batch;
  perform app.write_audit(v_org, 'import.revert', 'import_batch', p_batch, '{}'::jsonb);
end;
$$;

grant execute on function app.import_validate(uuid) to authenticated, service_role;
grant execute on function app.import_commit(uuid)   to authenticated, service_role;
grant execute on function app.import_revert(uuid, text) to authenticated, service_role;
