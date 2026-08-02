-- 0058_import_tenant_identity.sql
-- Sprint M-2: teach the importer the identity rules that 0057 put on app.party.
--
-- Without this the tenants importer is simply broken: it inserts a party with roles={tenant} and no
-- identifier, which 0057's guard refuses, and because import_commit runs as one transaction a single
-- such row would abort the whole batch with a raw Postgres error. Requirements have to be caught
-- during VALIDATE, where they become a per-field message on the offending row.
--
-- import_validate and import_commit are re-emitted here because Postgres has no way to patch one
-- branch of a function. To keep that re-emission honest, the tenant logic is first extracted into
-- small functions of its own — the two big functions differ from their previous versions (0047 and
-- 0016) only in the two branches that now delegate.
--
-- New optional sheet columns: رقم الإقامة · رقم الجواز · الرقم الموحد · السجل التجاري ·
-- الرقم الضريبي · اسم الممثل · رقم هوية الممثل · صفة الممثل · جوال الممثل.

-- ---------------------------------------------------------------------------
-- Tenant type from the Arabic sheet value. Unknown or blank reads as an individual, which is what
-- the column already defaulted to before this migration.
-- ---------------------------------------------------------------------------
create or replace function app.map_entity_type(p_value text) returns text
language sql immutable as $$
  select case
    when p_value is null or btrim(p_value) = '' then 'individual'
    when btrim(p_value) in ('شركة', 'شركه') or lower(btrim(p_value)) = 'company' then 'company'
    when btrim(p_value) like 'مؤسس%' or lower(btrim(p_value)) in ('establishment', 'sole_establishment')
      then 'sole_establishment'
    else 'individual'
  end;
$$;

-- ---------------------------------------------------------------------------
-- The identifier columns, normalised exactly the way app.party stores them, so what validate checks
-- is what commit will write.
-- ---------------------------------------------------------------------------
create or replace function app.import_tenant_ids(p_raw jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'national_id',    app.digits_only(p_raw->>'رقم الهوية'),
    'iqama_id',       app.digits_only(p_raw->>'رقم الإقامة'),
    'passport_no',    nullif(upper(regexp_replace(coalesce(p_raw->>'رقم الجواز', ''), '[^A-Za-z0-9]', '', 'g')), ''),
    'unified_number', app.digits_only(p_raw->>'الرقم الموحد'),
    'cr_number',      app.digits_only(p_raw->>'السجل التجاري'),
    'vat_number',     app.digits_only(p_raw->>'الرقم الضريبي'),
    'rep_id_number',  app.digits_only(p_raw->>'رقم هوية الممثل'),
    'rep_name',       nullif(btrim(coalesce(p_raw->>'اسم الممثل', '')), ''),
    'rep_capacity',   nullif(btrim(coalesce(p_raw->>'صفة الممثل', '')), ''),
    'rep_phone_raw',  nullif(btrim(coalesce(p_raw->>'جوال الممثل', '')), '')
  ));
$$;

-- ---------------------------------------------------------------------------
-- Every reason this tenant row cannot be accepted, as import_err entries. Messages are Arabic and
-- user-facing; the shapes themselves come from app.id_pattern so they cannot drift from the guard.
-- ---------------------------------------------------------------------------
create or replace function app.import_tenant_errors(p_ids jsonb, p_type text) returns jsonb
language plpgsql immutable as $$
declare
  errs jsonb := '[]'::jsonb;
  n_personal int := num_nonnulls(p_ids->>'national_id', p_ids->>'iqama_id', p_ids->>'passport_no');
begin
  if p_type = 'individual' then
    if n_personal = 0 then
      errs := errs || app.import_err('رقم الهوية', null::text, 'مطلوب: رقم الهوية أو الإقامة أو الجواز');
    elsif n_personal > 1 then
      errs := errs || app.import_err('رقم الهوية', null::text, 'اكتب معرّفاً واحداً فقط لكل مستأجر');
    end if;
  else
    if p_ids->>'unified_number' is null then
      errs := errs || app.import_err('الرقم الموحد', null::text, 'مطلوب للمؤسسة والشركة');
    end if;
    if p_ids->>'rep_name' is null then
      errs := errs || app.import_err('اسم الممثل', null::text, 'مطلوب للمؤسسة والشركة');
    end if;
    if p_ids->>'rep_id_number' is null then
      errs := errs || app.import_err('رقم هوية الممثل', null::text, 'مطلوب للمؤسسة والشركة');
    end if;
    if app.normalize_phone_e164(p_ids->>'rep_phone_raw') is null then
      errs := errs || app.import_err('جوال الممثل', p_ids->>'rep_phone_raw', 'مطلوب ويجب أن يكون رقماً صالحاً');
    end if;
  end if;

  if p_ids->>'national_id' is not null and p_ids->>'national_id' !~ app.id_pattern('national') then
    errs := errs || app.import_err('رقم الهوية', p_ids->>'national_id', 'يجب أن يكون 10 أرقام تبدأ بـ 1');
  end if;
  if p_ids->>'iqama_id' is not null and p_ids->>'iqama_id' !~ app.id_pattern('iqama') then
    errs := errs || app.import_err('رقم الإقامة', p_ids->>'iqama_id', 'يجب أن يكون 10 أرقام تبدأ بـ 2');
  end if;
  if p_ids->>'unified_number' is not null and p_ids->>'unified_number' !~ app.id_pattern('unified') then
    errs := errs || app.import_err('الرقم الموحد', p_ids->>'unified_number', 'يجب أن يكون 10 أرقام تبدأ بـ 7');
  end if;
  if p_ids->>'cr_number' is not null and p_ids->>'cr_number' !~ app.id_pattern('cr') then
    errs := errs || app.import_err('السجل التجاري', p_ids->>'cr_number', 'يجب أن يكون 10 أرقام');
  end if;
  if p_ids->>'vat_number' is not null and p_ids->>'vat_number' !~ app.id_pattern('vat') then
    errs := errs || app.import_err('الرقم الضريبي', p_ids->>'vat_number', 'يجب أن يكون 15 رقماً يبدأ وينتهي بـ 3');
  end if;
  if p_ids->>'rep_id_number' is not null and p_ids->>'rep_id_number' !~ app.id_pattern('rep') then
    errs := errs || app.import_err('رقم هوية الممثل', p_ids->>'rep_id_number', 'يجب أن يكون 10 أرقام تبدأ بـ 1 أو 2');
  end if;
  return errs;
end;
$$;

-- ---------------------------------------------------------------------------
-- One tenant row: name, contact, type, identifiers, and both duplicate checks. Returns
-- {"normalized": {...}, "errors": [...]} so the caller stays two lines long.
-- ---------------------------------------------------------------------------
create or replace function app.import_validate_tenant(p_org uuid, p_batch uuid, p_row int, p_raw jsonb)
returns jsonb
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  norm  jsonb := '{}'::jsonb;
  errs  jsonb := '[]'::jsonb;
  ids   jsonb := app.import_tenant_ids(p_raw);
  v_type text := app.map_entity_type(p_raw->>'النوع');
  v_primary text;
  s     text;
begin
  s := nullif(btrim(p_raw->>'الاسم'), '');
  if s is null then errs := errs || app.import_err('الاسم', p_raw->>'الاسم', 'حقل مطلوب');
  else norm := norm || jsonb_build_object('display_name', s); end if;

  s := btrim(coalesce(p_raw->>'الجوال', ''));
  if s <> '' then
    if app.normalize_phone_e164(s) is null
      then errs := errs || app.import_err('الجوال', s, 'رقم جوال غير صالح');
      else norm := norm || jsonb_build_object('phone_e164', app.normalize_phone_e164(s), 'phone_raw', s);
    end if;
  end if;

  -- For an establishment the personal columns describe the REPRESENTATIVE, so they are not carried
  -- onto the entity itself. app.party would refuse both anyway (one identifier per row).
  if v_type <> 'individual' then
    ids := ids - 'national_id' - 'iqama_id' - 'passport_no';
  end if;
  errs := errs || app.import_tenant_errors(ids, v_type);

  v_primary := coalesce(ids->>'unified_number', ids->>'national_id', ids->>'iqama_id', ids->>'passport_no');
  if v_primary is not null then
    if exists (select 1 from app.party
                where org_id = p_org and primary_id = v_primary and deleted_at is null) then
      errs := errs || app.import_err('المعرّف', v_primary, 'يوجد مستأجر بنفس المعرّف في المنصة');
    elsif exists (select 1 from app.import_row
                   where batch_id = p_batch and row_number < p_row and normalized->>'primary_id' = v_primary) then
      errs := errs || app.import_err('المعرّف', v_primary, 'مكرّر داخل هذا الملف');
    end if;
  end if;

  return jsonb_build_object(
    'normalized', norm || ids || jsonb_build_object(
      'entity_type', v_type,
      'legal_kind',  case when v_type = 'company' then 'company' else 'individual' end,
      'primary_id',  v_primary,
      'email',       nullif(btrim(coalesce(p_raw->>'البريد الإلكتروني', '')), '')),
    'errors', errs);
end;
$$;

-- tenant.tenant_type / tenant_kind are maintained by the 0057 trigger, so they are not written here.
create or replace function app.import_commit_tenant(p_org uuid, p_norm jsonb) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare v_party uuid; v_tenant uuid;
begin
  insert into app.party (org_id, display_name, legal_kind, entity_type,
                         national_id, iqama_id, passport_no,
                         unified_number, cr_number, vat_number,
                         rep_name, rep_id_number, rep_capacity, rep_phone_raw,
                         phone_e164, phone_raw, email, roles)
  values (p_org, p_norm->>'display_name', (p_norm->>'legal_kind')::app.legal_kind, p_norm->>'entity_type',
          p_norm->>'national_id', p_norm->>'iqama_id', p_norm->>'passport_no',
          p_norm->>'unified_number', p_norm->>'cr_number', p_norm->>'vat_number',
          p_norm->>'rep_name', p_norm->>'rep_id_number', p_norm->>'rep_capacity', p_norm->>'rep_phone_raw',
          -- Schema-qualified on purpose: citext lives in public (0001) while this function's
          -- search_path is app, so the bare type name does not resolve. The 0016 tenants branch
          -- carried the unqualified cast and failed the moment it was reached.
          p_norm->>'phone_e164', p_norm->>'phone_raw', (p_norm->>'email')::public.citext,
          array['tenant']::app.party_role[])
  returning id into v_party;

  insert into app.tenant (org_id, party_id) values (p_org, v_party) returning id into v_tenant;
  return v_tenant;
end;
$$;

-- ===========================================================================
-- import_validate — re-emitted from 0047. Only the 'tenants' branch changed.
-- ===========================================================================
create or replace function app.import_validate(p_batch uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  v_org  uuid;
  v_kind app.import_kind;
  r      app.import_row;
  norm   jsonb;
  errs   jsonb;
  res    jsonb;
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
        res  := app.import_validate_tenant(v_org, p_batch, r.row_number, r.raw);
        norm := res->'normalized';
        errs := res->'errors';

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
        -- tenant by identifier or name. The identifier column now matches any primary id, so a sheet
        -- that carries a company's unified number resolves the same way a national id does.
        s := nullif(btrim(coalesce(r.raw->>'رقم هوية المستأجر', '')), '');
        ref_id := null;
        if s is not null then
          -- Matched in both normalised forms, since a passport is letters+digits and everything
          -- else is digits-only, and the sheet does not say which one it carries.
          select t.id into ref_id from app.tenant t join app.party p on p.id = t.party_id
            where t.org_id = v_org and t.deleted_at is null
              and p.primary_id in (app.digits_only(s), nullif(upper(regexp_replace(s, '[^A-Za-z0-9]', '', 'g')), ''))
            limit 1;
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
          'deed_number', nullif(trim(r.raw->>'رقم الصك'), ''),
          'trade_name', nullif(trim(r.raw->>'الاسم التجاري'), ''));

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

-- ===========================================================================
-- import_commit — re-emitted from 0016. Only the 'tenants' branch and the contract trade_name
-- passthrough changed.
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
      new_id := app.import_commit_tenant(v_org, n);
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
                                trade_name, status)
      values (v_org, (n->>'property_id')::uuid, (n->>'unit_id')::uuid, (n->>'tenant_id')::uuid,
              n->>'contract_number', n->>'ejar_contract_number', n->>'deed_number',
              (n->>'start_date')::date, (n->>'end_date')::date,
              (n->>'annual_rent_halalas')::bigint, (n->>'payment_frequency')::app.payment_frequency,
              (n->>'deposit_halalas')::bigint, (n->>'service_fees_halalas')::bigint,
              n->>'trade_name', 'draft')
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
