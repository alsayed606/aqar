-- 0033_viewer_readonly.sql
-- Sprint B / هـ-16, مر-14: enforce that the `viewer` role is TRULY read-only, at the database.
-- Until now the middle roles (manager/accountant/staff/viewer) all wrote like any active member;
-- a 'viewer' could INSERT/UPDATE/DELETE. We close only the viewer gap here (the fuller per-role
-- permission matrix is a separate product decision, deferred).
--
-- Mechanism: RESTRICTIVE policies AND-combine with the existing permissive policies. We add
-- restrictive INSERT/UPDATE (+ DELETE where granted) policies gated on app.is_org_writer(), leaving
-- SELECT untouched (viewers still read). SECURITY DEFINER RPCs (org creation, invitation accept,
-- portal reads, counters, audit) run above RLS and are unaffected; SECURITY INVOKER writes
-- (activate_contract, record_charge_payment, amend/renew, issue_invoice…) are correctly blocked for
-- a viewer. Idempotent (drop policy if exists). §6.

-- The write gate: active membership in the active org whose role is not 'viewer'.
create or replace function app.is_org_writer(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.has_org_access(p_org)
     and exists (
       select 1 from app.membership m
       where m.identity_id = auth.uid()
         and m.org_id      = p_org
         and m.status      = 'active'
         and m.deleted_at is null
         and m.role <> 'viewer'
     );
$$;
revoke all on function app.is_org_writer(uuid) from public;
grant execute on function app.is_org_writer(uuid) to authenticated, service_role;

-- Member-writable tables that carry org_id directly → restrictive INSERT + UPDATE for non-viewers.
do $$
declare t text;
begin
  foreach t in array array[
    'party','owner','tenant',
    'property','building','unit','unit_status_history',
    'contract','contract_amendment','management_agreement',
    'charge','payment','payment_allocation',
    'document','import_batch','import_row',
    'invoice','invoice_line','owner_remittance'
  ] loop
    execute format('drop policy if exists %I on app.%I', t || '_writer_ins', t);
    execute format(
      'create policy %I on app.%I as restrictive for insert with check (app.is_org_writer(org_id))',
      t || '_writer_ins', t);
    execute format('drop policy if exists %I on app.%I', t || '_writer_upd', t);
    execute format(
      'create policy %I on app.%I as restrictive for update using (app.is_org_writer(org_id)) with check (app.is_org_writer(org_id))',
      t || '_writer_upd', t);
  end loop;
end $$;

-- payment_allocation grants DELETE to authenticated → gate it too.
drop policy if exists payment_allocation_writer_del on app.payment_allocation;
create policy payment_allocation_writer_del on app.payment_allocation
  as restrictive for delete using (app.is_org_writer(org_id));

-- management_agreement_unit has no org_id → resolve org via its parent agreement (INSERT/UPDATE/DELETE).
drop policy if exists mgmt_unit_writer_ins on app.management_agreement_unit;
create policy mgmt_unit_writer_ins on app.management_agreement_unit
  as restrictive for insert
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)));
drop policy if exists mgmt_unit_writer_upd on app.management_agreement_unit;
create policy mgmt_unit_writer_upd on app.management_agreement_unit
  as restrictive for update
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)))
  with check (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)));
drop policy if exists mgmt_unit_writer_del on app.management_agreement_unit;
create policy mgmt_unit_writer_del on app.management_agreement_unit
  as restrictive for delete
  using (exists (select 1 from app.management_agreement a where a.id = agreement_id and app.is_org_writer(a.org_id)));
