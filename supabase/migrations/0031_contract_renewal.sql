-- 0031_contract_renewal.sql
-- Contract renewal (تجديد العقد) done the immutability-safe way: a renewal is a NEW successor
-- contract, never an edit of the frozen predecessor. end_date is a legal field frozen after
-- activation (tg_contract_immutable), so "extending" a contract is modelled as a follow-on:
--
--   * renew_contract   — create a DRAFT successor copied from the source (same unit/tenant/property,
--     kind, frequency, deposit, fees), with new start/end/rent and a back-link renewed_from_contract_id.
--     The source is untouched; the office reviews the draft then activates it.
--   * activate_renewal — atomically retire the predecessor and start the successor: if the source is
--     still 'active', cancel its future still-untouched dues (>= the successor start, to avoid an
--     overlap double-charge) and move it 'active' → 'expired', THEN reuse activate_contract to build
--     the successor's schedule and mark the unit rented. Order matters: the source leaves 'active'
--     before the successor enters it, so the one-active-per-unit partial index is always satisfied.
--
-- Both are SECURITY INVOKER (RLS + property scope apply) and atomic.

-- Back-link a successor to its predecessor. Nullable; only set at draft-insert time, never updated
-- (so the immutability guard, which does not list it, is irrelevant here).
alter table app.contract
  add column if not exists renewed_from_contract_id uuid references app.contract(id);

create index if not exists contract_renewed_from_idx
  on app.contract (renewed_from_contract_id) where renewed_from_contract_id is not null;

-- ---------------------------------------------------------------------------
-- renew_contract(source, start, end, new_annual, number) -> new draft contract id
-- Renews an active or already-expired contract. Blocks a second live renewal off the same source.
-- ---------------------------------------------------------------------------
create or replace function app.renew_contract(
  p_source     uuid,
  p_start      date,
  p_end        date,
  p_new_annual bigint,
  p_number     text default null
) returns uuid
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  s        app.contract;
  v_number text;
  v_new    uuid;
begin
  select * into s from app.contract where id = p_source and deleted_at is null;
  if s.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if s.status not in ('active', 'expired') then
    raise exception 'CONTRACT_NOT_RENEWABLE: only active or expired contracts can be renewed'
      using errcode = 'raise_exception';
  end if;

  -- One live successor per source (a cancelled/deleted draft does not count).
  if exists (
    select 1 from app.contract r
    where r.renewed_from_contract_id = s.id and r.status <> 'cancelled' and r.deleted_at is null
  ) then
    raise exception 'ALREADY_RENEWED: this contract already has a renewal' using errcode = 'raise_exception';
  end if;

  if p_start is null or p_end is null then raise exception 'DATES_REQUIRED' using errcode = 'raise_exception'; end if;
  if p_end < p_start then raise exception 'END_BEFORE_START' using errcode = 'raise_exception'; end if;
  if p_new_annual is null or p_new_annual < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'raise_exception'; end if;

  v_number := coalesce(nullif(btrim(p_number), ''), s.contract_number || '-R' || extract(year from p_start)::int);

  insert into app.contract (
    org_id, property_id, unit_id, tenant_id, contract_number, deed_number, contract_kind,
    status, start_date, end_date, annual_rent_halalas, payment_frequency,
    deposit_halalas, service_fees_halalas, terms, renewed_from_contract_id, created_by
  ) values (
    s.org_id, s.property_id, s.unit_id, s.tenant_id, v_number, s.deed_number, s.contract_kind,
    'draft', p_start, p_end, p_new_annual, s.payment_frequency,
    s.deposit_halalas, s.service_fees_halalas, s.terms, s.id, auth.uid()
  )
  returning id into v_new;

  perform app.write_audit(s.org_id, 'contract.renew', 'contract', s.id,
                          jsonb_build_object('successor', v_new, 'start', p_start, 'end', p_end,
                                             'annual_rent_halalas', p_new_annual));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- activate_renewal(new) — retire the predecessor, then activate the successor. Atomic.
-- ---------------------------------------------------------------------------
create or replace function app.activate_renewal(p_new uuid) returns void
language plpgsql security invoker set search_path = app, pg_temp as $$
declare
  n app.contract;
  s app.contract;
begin
  select * into n from app.contract where id = p_new and deleted_at is null;
  if n.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;
  if n.renewed_from_contract_id is null then
    raise exception 'NOT_A_RENEWAL: this contract is not a renewal' using errcode = 'raise_exception';
  end if;
  if n.status <> 'draft' then
    raise exception 'CONTRACT_NOT_DRAFT: only a draft renewal can be activated' using errcode = 'raise_exception';
  end if;

  select * into s from app.contract where id = n.renewed_from_contract_id and deleted_at is null;
  if s.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'raise_exception'; end if;

  if s.status = 'active' then
    -- Cancel the source's future, still-untouched dues that would overlap the successor.
    update app.charge ch set deleted_at = now(), deleted_reason = 'superseded_by_renewal'
    where ch.contract_id = s.id and ch.deleted_at is null and ch.due_date >= n.start_date
      and not exists (select 1 from app.payment_allocation a where a.charge_id = ch.id);

    update app.contract set status = 'expired' where id = s.id;
  elsif s.status <> 'expired' then
    -- Source was terminated/cancelled after the draft was prepared — refuse rather than guess.
    raise exception 'SOURCE_NOT_RENEWABLE: the predecessor is no longer active or expired'
      using errcode = 'raise_exception';
  end if;

  -- Reuse the canonical activation (schedule generation + unit → rented). The source has already
  -- left 'active', so the one-active-per-unit index accepts the successor.
  perform app.activate_contract(p_new);

  perform app.write_audit(n.org_id, 'contract.renew_activate', 'contract', n.id,
                          jsonb_build_object('predecessor', s.id));
end;
$$;

revoke all on function app.renew_contract(uuid, date, date, bigint, text) from public;
revoke all on function app.activate_renewal(uuid) from public;
grant execute on function app.renew_contract(uuid, date, date, bigint, text) to authenticated, service_role;
grant execute on function app.activate_renewal(uuid) to authenticated, service_role;
