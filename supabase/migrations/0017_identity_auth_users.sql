-- 0017_identity_auth_users.sql
-- Bind our global Identity to Supabase Auth (GoTrue). Decision: use Supabase Auth for phone OTP;
-- app.identity becomes a 1:1 profile of auth.users (identity.id = auth.users.id = auth.uid()), so the
-- RLS that keys on auth.uid() works natively. A trigger auto-creates the identity profile on signup.
--
-- Supabase-safe / CI-safe: the FK and the trigger on auth.users are only installed when auth.users
-- exists (Supabase). On bare Postgres (local tests) this migration is a no-op except for defining the
-- function, so the existing suite keeps passing.

-- Profile creator: runs on every new auth.users row. Normalizes the phone to strict E.164 and
-- inserts the identity with the SAME id. SECURITY DEFINER so it can write app.identity.
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text;
begin
  v_phone := app.normalize_phone_e164(new.phone);
  -- Phone-first: only provision an identity when we have a valid KSA mobile (the global key).
  if v_phone is not null then
    insert into app.identity (id, phone_e164, phone_raw, email)
    values (new.id, v_phone, new.phone, new.email)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

do $do$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    -- 1:1 link identity.id -> auth.users.id
    if not exists (select 1 from pg_constraint where conname = 'identity_auth_user_fk') then
      execute 'alter table app.identity
                 add constraint identity_auth_user_fk
                 foreign key (id) references auth.users(id) on delete cascade';
    end if;

    -- Auto-provision the profile on signup.
    execute 'drop trigger if exists on_auth_user_created on auth.users';
    execute 'create trigger on_auth_user_created
               after insert on auth.users
               for each row execute function app.handle_new_auth_user()';
  end if;
end
$do$;
