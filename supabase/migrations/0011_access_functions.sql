-- 0011_access_functions.sql
-- The isolation core. Every RLS policy is expressed in terms of these helpers. SCHEMA.md §6.
--
-- Design invariants:
--   * org_id is NEVER read from the JWT. The active org arrives as request context and is treated
--     as an UNTRUSTED claim, proven against live membership on every single query.
--   * The membership proof lives in SECURITY DEFINER functions with a fixed search_path, so the
--     membership table's own RLS policy can call them without infinite recursion.
--   * Functions are STABLE, so Postgres caches them within a statement/request → cheap at scale.

-- ---------------------------------------------------------------------------
-- current_org_id() — the active org for this request.
-- Priority 1: a GUC set by trusted server code (Edge Functions / service role).
-- Priority 2: the x-active-org request header (PostgREST). Untrusted; proven below.
-- Fails closed (NULL) → policies deny.
-- ---------------------------------------------------------------------------
create or replace function app.current_org_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('app.current_org_id', true), ''),
    nullif(
      (nullif(current_setting('request.headers', true), '')::json ->> 'x-active-org'),
      ''
    )
  )::uuid;
$$;

-- ---------------------------------------------------------------------------
-- has_org_access(p_org) — the single gate used by every org-scoped policy.
-- True only when: the row's org equals the active org context AND the caller has a LIVE active
-- membership in it. Revoking a membership flips this to false on the very next query. §10 test 2.
-- SECURITY DEFINER + fixed search_path → does not trigger membership RLS (no recursion). §6.
-- ---------------------------------------------------------------------------
create or replace function app.has_org_access(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select p_org is not null
     and p_org = app.current_org_id()
     and exists (
       select 1
       from app.membership m
       where m.identity_id = auth.uid()
         and m.org_id      = p_org
         and m.status      = 'active'
         and m.deleted_at is null
     );
$$;

-- ---------------------------------------------------------------------------
-- has_property_access(p_org, p_property) — the second isolation layer (portfolio scope). §6.
-- A membership with scope_all sees everything in its org; otherwise it is confined to the
-- properties listed in membership_property_scope. NULL property (org-level rows) → org gate only.
-- ---------------------------------------------------------------------------
create or replace function app.has_property_access(p_org uuid, p_property uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.has_org_access(p_org)
     and (
       p_property is null
       or exists (
         select 1
         from app.membership m
         where m.identity_id = auth.uid()
           and m.org_id      = p_org
           and m.status      = 'active'
           and m.deleted_at is null
           and (
             m.scope_all
             or exists (
               select 1 from app.membership_property_scope s
               where s.membership_id = m.id
                 and s.property_id    = p_property
             )
           )
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- current_membership_id() — the caller's membership in the active org. Stamped onto audit rows
-- as the third identifier (role/scope at the time of the action). §8.
-- ---------------------------------------------------------------------------
create or replace function app.current_membership_id() returns uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select m.id
  from app.membership m
  where m.identity_id = auth.uid()
    and m.org_id      = app.current_org_id()
    and m.status      = 'active'
    and m.deleted_at is null
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- is_org_admin(p_org) — owner/admin gate for member management and other privileged writes.
-- ---------------------------------------------------------------------------
create or replace function app.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = app, pg_temp as $$
  select app.has_org_access(p_org)
     and exists (
       select 1 from app.membership m
       where m.identity_id = auth.uid()
         and m.org_id      = p_org
         and m.status      = 'active'
         and m.deleted_at is null
         and m.role in ('owner', 'admin')
     );
$$;

-- Lock down who may execute the access helpers.
revoke all on function app.current_org_id()           from public;
revoke all on function app.has_org_access(uuid)        from public;
revoke all on function app.has_property_access(uuid, uuid) from public;
revoke all on function app.current_membership_id()     from public;
revoke all on function app.is_org_admin(uuid)          from public;

grant execute on function app.current_org_id()           to authenticated, service_role;
grant execute on function app.has_org_access(uuid)        to authenticated, service_role;
grant execute on function app.has_property_access(uuid, uuid) to authenticated, service_role;
grant execute on function app.current_membership_id()     to authenticated, service_role;
grant execute on function app.is_org_admin(uuid)          to authenticated, service_role;
