-- 0073_tenant_portal_units.sql
-- One missing read, found while building the portal's maintenance form.
--
-- app.submit_maintenance_request (0072) takes a unit id, and the tenant portal had no way to learn
-- one: tenant_portal_contracts returns the unit NUMBER for display, and RLS on app.unit — rightly —
-- shows a tenant nothing. So the form could name the unit but not identify it.
--
-- This is additive on purpose. Adding a column to tenant_portal_contracts would mean dropping and
-- recreating a function three screens already call, to fix a need only one of them has.
--
-- Active contracts only, which is the same rule submit_maintenance_request enforces: offering a
-- tenant a unit the database will then refuse is a form that exists to be rejected.
create or replace function app.tenant_portal_units(p_tenant uuid)
returns table (unit_id uuid, unit_number text, property_name text)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.tenant_is_mine(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'raise_exception';
  end if;
  return query
    select distinct u.id, u.unit_number, p.name
    from app.contract c
    join app.unit     u on u.id = c.unit_id
    join app.property p on p.id = c.property_id
    where c.tenant_id = p_tenant
      and c.status = 'active'
      and c.deleted_at is null
    order by p.name, u.unit_number;
end;
$$;

-- 0053 rule: 0001 grants execute to anon/authenticated by default privilege, so a bare
-- `revoke from public` would close nothing. Revoke by name, then grant back deliberately.
revoke all on function app.tenant_portal_units(uuid) from public, anon, authenticated;
grant execute on function app.tenant_portal_units(uuid) to authenticated;

select app.record_migration('0073', 'tenant_portal_units');
