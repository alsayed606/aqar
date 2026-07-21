-- 0001_extensions_roles.sql
-- Extensions, application schema, and the Supabase auth roles.
-- Idempotent so it can run on a bare Postgres (CI / pgTAP) as well as on Supabase.

create schema if not exists app;
-- Extensions live in their own schema (the Supabase convention) so SECURITY DEFINER functions can
-- pin a fixed search_path that includes it, rather than trusting public.
create schema if not exists extensions;

-- pgcrypto: gen_random_bytes(), digest(), crypt(), gen_salt() → schema 'extensions'.
create extension if not exists pgcrypto with schema extensions;
-- citext: case-insensitive, unique e-mail. Kept in public so the citext TYPE resolves in plain DDL.
create extension if not exists citext;

-- Supabase ships these roles; recreate them on bare Postgres so migrations + tests run anywhere.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema app to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Default privileges: the API roles only ever touch tables through RLS. We grant table DML
-- explicitly per table in 0012; here we make sure future objects created by the migration owner
-- are reachable by the executor of SECURITY DEFINER helpers.
alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;
