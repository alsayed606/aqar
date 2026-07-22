-- 0027_contract_amendments.sql
-- The sanctioned way to change an ACTIVE contract (which is immutable — see tg_contract_immutable):
-- record a versioned app.contract_amendment and apply the effect on the mutable side (charges,
-- lifecycle status), never by editing the frozen legal fields.
--
--   * amend_contract_rent      — from an effective date, re-price the FUTURE, still-untouched charges
--     at a new annual rent. The contract's annual_rent_halalas stays the original legal figure; the
--     amendment payload records from→to; only charges with no payments yet are re-priced (a
--     part-paid charge is left as-is to avoid orphaning allocations).
--   * amend_contract_terminate — end an active contract early: status→terminated (+reason/timestamp,
--     all lifecycle-allowed), cancel future untouched dues, and free the unit. end_date (frozen)
--     is untouched; the amendment records the effective early-end date.
--
-- Both are SECURITY INVOKER (RLS + property scope apply) and atomic.

-- Frequency → (#periods per year, month step). Mirrors activate_contract (0019).
create or replace function app.contract_period_shape(p_freq app.payment_frequency)
returns table (periods int, step int)
language sql immutable as $$
  select case p_freq
           when 'monthly' then 12 when 'quarterly' then 4
           when 'semi_annual' then 2 when 'annual' then 1 else 1 end,
         case p_freq
           when 'monthly' then 1 when 'quarterly' then 3
           when 'semi_annual' then 6 when 'annual' then 12 else 0 end;
$$;

create or replace function app.amend_contract_rent(
  p_contract uuid, p_new_annual bigint, p_effective date, p_reason text
) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  c         app.contract;
  v_periods int;
  v_base    bigint;
  v_rem     bigint;
  v_rate    numeric(5,4);
  v_type    app.charge_type;
  v_last    date;
  v_amend   uuid;
  v_ver     int;
  r         record;
begin
  select * into c from app.contract where id = p_contract and deleted_at is null;
  if c.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if c.status <> 'active' then raise exception 'CONTRACT_NOT_ACTIVE: only active contracts can be amended' using errcode = 'raise_exception'; end if;
  if p_new_annual is null or p_new_annual < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'raise_exception'; end if;

  select periods into v_periods from app.contract_period_shape(c.payment_frequency);
  v_base := p_new_annual / v_periods;
  v_rem  := p_new_annual - v_base * v_periods;
  if c.contract_kind = 'commercial' then v_rate := 0.15; v_type := 'commercial_rent';
  else v_rate := 0; v_type := 'residential_rent'; end if;

  -- The true last due date of the whole schedule (so the rounding remainder lands on it).
  select max(due_date) into v_last from app.charge where contract_id = c.id and deleted_at is null;

  v_ver := (select coalesce(max(version), 0) + 1 from app.contract_amendment where contract_id = c.id);
  insert into app.contract_amendment (org_id, contract_id, version, change_type, payload, effective_date, reason, created_by)
  values (c.org_id, c.id, v_ver, 'rent_change',
          jsonb_build_object('annual_rent_halalas', jsonb_build_object('from', c.annual_rent_halalas, 'to', p_new_annual)),
          p_effective, p_reason, auth.uid())
  returning id into v_amend;

  -- Re-price each future, still-untouched charge (no allocations) at the new per-period amount.
  for r in
    select ch.id, ch.due_date
    from app.charge ch
    where ch.contract_id = c.id and ch.deleted_at is null and ch.due_date >= p_effective
      and not exists (select 1 from app.payment_allocation a where a.charge_id = ch.id)
  loop
    update app.charge set deleted_at = now(), deleted_reason = 'rent_amendment' where id = r.id;
    insert into app.charge (org_id, property_id, unit_id, contract_id, charge_type, due_date,
      amount_excl_vat_halalas, vat_rate, vat_amount_halalas, description)
    values (c.org_id, c.property_id, c.unit_id, c.id, v_type, r.due_date,
      v_base + case when r.due_date = v_last then v_rem else 0 end,
      v_rate,
      round((v_base + case when r.due_date = v_last then v_rem else 0 end) * v_rate),
      'إيجار — بعد تعديل الإيجار');
  end loop;

  perform app.write_audit(c.org_id, 'contract.amend_rent', 'contract', c.id,
                          jsonb_build_object('amendment', v_amend, 'new_annual', p_new_annual));
  return v_amend;
end;
$$;

create or replace function app.amend_contract_terminate(
  p_contract uuid, p_effective date, p_reason text
) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  c       app.contract;
  v_amend uuid;
  v_ver   int;
begin
  select * into c from app.contract where id = p_contract and deleted_at is null;
  if c.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if c.status <> 'active' then raise exception 'CONTRACT_NOT_ACTIVE: only active contracts can be terminated' using errcode = 'raise_exception'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'raise_exception'; end if;

  v_ver := (select coalesce(max(version), 0) + 1 from app.contract_amendment where contract_id = c.id);
  insert into app.contract_amendment (org_id, contract_id, version, change_type, payload, effective_date, reason, created_by)
  values (c.org_id, c.id, v_ver, 'early_termination',
          jsonb_build_object('status', jsonb_build_object('from', 'active', 'to', 'terminated'),
                             'effective_date', p_effective),
          p_effective, p_reason, auth.uid())
  returning id into v_amend;

  update app.contract set status = 'terminated', terminated_at = now(), termination_reason = p_reason where id = c.id;

  -- Cancel future untouched dues (on/after the effective date, no payments against them).
  update app.charge ch set deleted_at = now(), deleted_reason = 'early_termination'
  where ch.contract_id = c.id and ch.deleted_at is null and ch.due_date >= p_effective
    and not exists (select 1 from app.payment_allocation a where a.charge_id = ch.id);

  -- Free the unit.
  update app.unit set current_status = 'vacant' where id = c.unit_id;

  perform app.write_audit(c.org_id, 'contract.terminate', 'contract', c.id,
                          jsonb_build_object('amendment', v_amend, 'effective', p_effective));
  return v_amend;
end;
$$;

revoke all on function app.amend_contract_rent(uuid, bigint, date, text) from public;
revoke all on function app.amend_contract_terminate(uuid, date, text) from public;
grant execute on function app.contract_period_shape(app.payment_frequency) to authenticated, service_role;
grant execute on function app.amend_contract_rent(uuid, bigint, date, text) to authenticated, service_role;
grant execute on function app.amend_contract_terminate(uuid, date, text) to authenticated, service_role;
