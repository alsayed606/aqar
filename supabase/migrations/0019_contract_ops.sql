-- 0019_contract_ops.sql
-- Atomic contract operations (business logic lives in the DB so it's transactional and RLS-covered):
--   * activate_contract: draft → active, generate the rent charge schedule, mark the unit rented.
--   * record_charge_payment: create a payment and allocate it to a charge (capped at the balance).
-- SECURITY INVOKER: runs as the caller, so RLS + the x-active-org context apply on every write.
-- Idempotent (create or replace); safe to run on the live DB.

-- ---------------------------------------------------------------------------
-- activate_contract(contract_id)
-- Frequency → number of periods and month step. Rent is split evenly (remainder on the last charge).
-- VAT: residential rent is exempt (0); commercial rent is 15%. The one-active-contract-per-unit
-- partial index enforces exclusivity; any failure rolls the whole activation back.
-- ---------------------------------------------------------------------------
create or replace function app.activate_contract(p_contract uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  c          app.contract;
  v_periods  int;
  v_interval int;
  v_base     bigint;
  v_rem      bigint;
  v_rate     numeric(5,4);
  v_type     app.charge_type;
  v_excl     bigint;
  i          int;
begin
  select * into c from app.contract where id = p_contract and deleted_at is null;
  if c.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if c.status <> 'draft' then raise exception 'CONTRACT_NOT_DRAFT: only draft contracts can be activated' using errcode = 'raise_exception'; end if;

  -- Activate first so the one-active-per-unit index rejects duplicates before we create charges.
  update app.contract set status = 'active', activated_at = now() where id = c.id;

  case c.payment_frequency
    when 'monthly'     then v_periods := 12; v_interval := 1;
    when 'quarterly'   then v_periods := 4;  v_interval := 3;
    when 'semi_annual' then v_periods := 2;  v_interval := 6;
    when 'annual'      then v_periods := 1;  v_interval := 12;
    else                    v_periods := 1;  v_interval := 0;   -- one_time / custom
  end case;

  v_base := c.annual_rent_halalas / v_periods;
  v_rem  := c.annual_rent_halalas - v_base * v_periods;

  if c.contract_kind = 'commercial' then
    v_rate := 0.15; v_type := 'commercial_rent';
  else
    v_rate := 0;    v_type := 'residential_rent';
  end if;

  for i in 0 .. v_periods - 1 loop
    v_excl := v_base + case when i = v_periods - 1 then v_rem else 0 end;
    insert into app.charge (
      org_id, property_id, unit_id, contract_id, charge_type, due_date,
      amount_excl_vat_halalas, vat_rate, vat_amount_halalas, description
    ) values (
      c.org_id, c.property_id, c.unit_id, c.id, v_type,
      (c.start_date + (i * v_interval) * interval '1 month')::date,
      v_excl, v_rate, round(v_excl * v_rate),
      'دفعة إيجار ' || (i + 1) || '/' || v_periods
    );
  end loop;

  update app.unit set current_status = 'rented' where id = c.unit_id;

  perform app.write_audit(c.org_id, 'contract.activate', 'contract', c.id,
                          jsonb_build_object('periods', v_periods));
end;
$$;

-- ---------------------------------------------------------------------------
-- record_charge_payment(charge_id, amount_halalas, method)
-- Creates a payment from the contract's tenant and allocates min(amount, remaining balance) to the
-- charge. Any excess stays as an unallocated on-account credit on the payment.
-- ---------------------------------------------------------------------------
create or replace function app.record_charge_payment(
  p_charge uuid,
  p_amount_halalas bigint,
  p_method app.payment_method default 'cash'
) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  ch        app.charge;
  v_party   uuid;
  v_balance bigint;
  v_alloc   bigint;
  v_pay     uuid;
begin
  if p_amount_halalas is null or p_amount_halalas <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception';
  end if;

  select * into ch from app.charge where id = p_charge and deleted_at is null;
  if ch.id is null then raise exception 'CHARGE_NOT_FOUND' using errcode = 'raise_exception'; end if;

  select ch.amount_incl_vat_halalas - coalesce(sum(a.amount_halalas), 0)
    into v_balance
  from app.payment_allocation a where a.charge_id = ch.id;

  select t.party_id into v_party
  from app.contract c join app.tenant t on t.id = c.tenant_id
  where c.id = ch.contract_id;

  insert into app.payment (org_id, party_id, method, amount_halalas)
  values (ch.org_id, v_party, p_method, p_amount_halalas)
  returning id into v_pay;

  v_alloc := least(p_amount_halalas, greatest(v_balance, 0));
  if v_alloc > 0 then
    insert into app.payment_allocation (org_id, payment_id, charge_id, amount_halalas)
    values (ch.org_id, v_pay, ch.id, v_alloc);
  end if;

  perform app.write_audit(ch.org_id, 'payment.record', 'charge', ch.id,
                          jsonb_build_object('amount', p_amount_halalas, 'allocated', v_alloc));
end;
$$;

revoke all on function app.activate_contract(uuid) from public;
revoke all on function app.record_charge_payment(uuid, bigint, app.payment_method) from public;
grant execute on function app.activate_contract(uuid) to authenticated, service_role;
grant execute on function app.record_charge_payment(uuid, bigint, app.payment_method) to authenticated, service_role;
