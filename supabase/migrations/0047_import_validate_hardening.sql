-- 0047_import_validate_hardening.sql
-- Follow-up to 0046, which fixed the two shared parsers. Three holes were left in the import
-- pipeline itself:
--
-- 1. 'نسبة الضريبة' was cast inline: nullif(app.fold_digits(...), '')::numeric. A '%' sign made
--    it raise and take the whole batch down (the 0046 failure mode, one layer up). Worse, the
--    template documents a fraction (0.15) but people type 15 — and 15 sailed through the cast and
--    multiplied the charge by 15. A silently 100x invoice is a heavier bug than a crash.
--
-- 2. 'المساحة' was never validated at all: import_validate stored the raw string and
--    import_commit cast it with ::numeric. So '120 م²' passed validation, the operator was told
--    the row was valid, pressed «اعتماد» — and the cast raised inside import_commit, which is one
--    transaction by design, rolling back the entire batch with nothing saved. Every field
--    import_commit casts must be proven readable during validation; that was the only one left.
--
-- 3. Nothing bounded the blast radius of a parse hole. Import rows are untrusted input, and two
--    of them have now escaped the row loop, so the loop body converts any remaining conversion
--    error into an error on its own row instead of losing the batch.
--
-- Also folds the shared "read a human-typed number" rule into one function: normalize_decimal.
-- normalize_amount_halalas keeps its exact contract and is now expressed in terms of it.

-- ---------------------------------------------------------------------------
-- Numeric normalization: any human string -> numeric, or null when unreadable.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_decimal(p_input text) returns numeric
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := replace(s, '٫', '.');                    -- Arabic decimal separator
  s := regexp_replace(s, '[^0-9.\-]', '', 'g'); -- drop currency, commas, spaces, units
  -- 'ر.س' and 'م²' leave their dot behind. Only a dot between digits can be a decimal separator;
  -- an edge dot is always leftover symbol. Dots in the middle stay, so '1.2.3' remains ambiguous
  -- and is rejected below rather than silently read as 1.2.
  s := regexp_replace(s, '^\.+|\.+$', '', 'g');

  if s = '' or s = '-' then
    return null;
  end if;

  begin
    return s::numeric;
  exception when data_exception then
    return null;
  end;
end;
$$;

create or replace function app.normalize_amount_halalas(p_input text) returns bigint
language plpgsql immutable as $$
declare
  v numeric;
begin
  v := app.normalize_decimal(p_input);
  if v is null then
    return null;
  end if;
  -- A nonsense figure can still overflow bigint on the halalas multiply.
  begin
    return round(v * 100)::bigint;
  exception when numeric_value_out_of_range then
    return null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tax rate: text -> fraction in 0..1, or null when unreadable.
-- The template documents 0.15, but 15, 15% and ٪١٥ are what people actually type. Reading a bare
-- 15 as a rate of 15 multiplies the charge by fifteen, so any value at or above 1 — and any value
-- carrying a percent sign — is read as a percentage. This makes a rate of exactly 100%
-- inexpressible, which no tax authority charges, and in exchange no invoice can be inflated 100x.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_rate(p_input text) returns numeric
language plpgsql immutable as $$
declare
  v numeric;
begin
  v := app.normalize_decimal(p_input);
  if v is null then
    return null;
  end if;
  if v >= 1 or p_input ~ '[%٪]' then
    v := v / 100;
  end if;
  if v < 0 or v > 1 then
    return null;
  end if;
  return v;
end;
$$;

-- ===========================================================================
-- import_validate — normalize every row, collect per-field errors, resolve references.
-- Re-emitted from 0016 with: a validated 'المساحة', a validated 'نسبة الضريبة', date errors that
-- state the accepted format, and a per-row guard around the body.
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
  num    numeric;
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
    n_total := n_total + 1;

    -- One unreadable cell fails its own row. Every conversion below is meant to be guarded
    -- already; this is the boundary that keeps the next missed one from costing the batch.
    begin
      norm := '{}'::jsonb;
      errs := '[]'::jsonb;

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
        -- Optional, but import_commit casts it to numeric — so prove it is readable here.
        s := nullif(trim(r.raw->>'المساحة'), '');
        if s is not null then
          num := app.normalize_decimal(s);
          if num is null or num < 0 then errs := errs || app.import_err('المساحة', s, 'مساحة غير صالحة');
          else norm := norm || jsonb_build_object('area_sqm', num); end if;
        end if;
        norm := norm || jsonb_build_object(
          'floor', nullif(trim(r.raw->>'الدور'), ''),
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
        if d1 is null then errs := errs || app.import_err('تاريخ البداية', r.raw->>'تاريخ البداية', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('start_date', d1); end if;
        if d2 is null then errs := errs || app.import_err('تاريخ النهاية', r.raw->>'تاريخ النهاية', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
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
        if d1 is null then errs := errs || app.import_err('تاريخ الاستحقاق', r.raw->>'تاريخ الاستحقاق', 'تاريخ غير صالح — الصيغة YYYY-MM-DD (السنة ثم الشهر ثم اليوم)');
        else norm := norm || jsonb_build_object('due_date', d1); end if;
        -- VAT rate defaults to 0 (residential rent is exempt); the sheet may override it.
        s := nullif(trim(r.raw->>'نسبة الضريبة'), '');
        if s is null then num := 0;
        else
          num := app.normalize_rate(s);
          if num is null then
            errs := errs || app.import_err('نسبة الضريبة', s, 'نسبة غير صالحة — اكتب 0.15 أو 15%');
          end if;
        end if;
        amt := app.normalize_amount_halalas(r.raw->>'المبلغ قبل الضريبة');
        if amt is null then errs := errs || app.import_err('المبلغ قبل الضريبة', r.raw->>'المبلغ قبل الضريبة', 'مبلغ غير صالح');
        elsif num is not null then
          norm := norm || jsonb_build_object(
            'amount_excl_vat_halalas', amt,
            'vat_rate', num,
            'vat_amount_halalas', round(amt * num)::bigint);
        end if;
        norm := norm || jsonb_build_object('description', nullif(trim(r.raw->>'الوصف'), ''));
      end if;

      update app.import_row
        set normalized = norm, errors = errs, is_valid = (jsonb_array_length(errs) = 0)
        where id = r.id;
      if jsonb_array_length(errs) = 0 then n_valid := n_valid + 1; else n_error := n_error + 1; end if;

    exception when data_exception then
      update app.import_row
        set normalized = '{}'::jsonb,
            errors = jsonb_build_array(app.import_err('الصف', null::text, 'تعذّرت قراءة هذا الصف: ' || sqlerrm)),
            is_valid = false
        where id = r.id;
      n_error := n_error + 1;
    end;
  end loop;

  update app.import_batch
    set status = 'validated', total_rows = n_total, valid_rows = n_valid, error_rows = n_error
    where id = p_batch;
end;
$$;
