-- 0018_org_visibility.sql
-- The org switcher must list the organizations a user belongs to BEFORE any active org is chosen
-- (chicken-and-egg: you can't pick an org you can't see). We let a signed-in user SELECT the
-- organization rows where they hold an active membership — independent of the x-active-org context.
--
-- Isolation is preserved: this only exposes orgs the caller is actually a member of, and it only
-- affects the `organization` table (name/type). All data INSIDE an org stays gated by
-- has_org_access(active org). Idempotent (re-runnable on the live DB).

create or replace function app.is_member_of(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select exists (
    select 1 from app.membership m
    where m.org_id = p_org
      and m.identity_id = auth.uid()
      and m.status = 'active'
      and m.deleted_at is null
  );
$$;
revoke all on function app.is_member_of(uuid) from public;
grant execute on function app.is_member_of(uuid) to authenticated, service_role;

-- Was: using (app.has_org_access(id)) — too strict (only the currently-active org was visible).
drop policy if exists organization_select on app.organization;
create policy organization_select on app.organization for select
  using (app.is_member_of(id));
