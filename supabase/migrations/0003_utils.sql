-- 0003_utils.sql
-- Table-independent utility functions: auth.uid() shim, normalization (phone / amount / date),
-- and the shared updated_at trigger function. These are pure and IMMUTABLE where possible so they
-- can be used inside CHECK constraints, generated columns, import, and tests alike.

-- ---------------------------------------------------------------------------
-- auth.uid() / auth.role() shim.
-- Supabase already defines these; we (re)define identically so the same SQL runs on bare Postgres.
-- Reads the JWT sub claim from the request GUC. Returns NULL when unauthenticated.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

-- IMPORTANT: On Supabase, auth.uid()/auth.role() already exist and are owned by
-- supabase_auth_admin — we must NOT replace them (permission error + would clobber Supabase Auth).
-- We only install a compatible shim when the function is ABSENT (bare Postgres / CI). Supabase's
-- native versions read the same request.jwt.claims, so behaviour is identical either way.
-- nullif(...,'') BEFORE ::json so an empty GUC ('' vs absent) can never raise "invalid json".
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid' and p.pronargs = 0
  ) then
    execute $fn$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid;
      $body$;
    $fn$;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'role' and p.pronargs = 0
  ) then
    execute $fn$
      create function auth.role() returns text language sql stable as $body$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', 'anon');
      $body$;
    $fn$;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- Digit folding: Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) to ASCII 0-9.
-- ---------------------------------------------------------------------------
create or replace function app.fold_digits(p_input text) returns text
language sql immutable as $$
  select translate(
    coalesce(p_input, ''),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789'
  );
$$;

-- ---------------------------------------------------------------------------
-- Saudi mobile normalization to strict E.164 (+9665XXXXXXXX).
-- Accepts: 05…, ٠٥…, 5…, 9665…, +966 5…, 00966…, with spaces/dashes/parentheses.
-- Returns the canonical +9665XXXXXXXX or NULL when the value is not a valid KSA mobile.
-- IMMUTABLE: safe inside CHECK constraints and generated columns.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_phone_e164(p_input text) returns text
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := regexp_replace(s, '[^0-9]', '', 'g');   -- keep digits only

  if s = '' then
    return null;
  end if;

  if left(s, 5) = '00966' then
    s := substr(s, 6);
  elsif left(s, 3) = '966' then
    s := substr(s, 4);
  elsif left(s, 1) = '0' then
    s := substr(s, 2);
  end if;

  -- Canonical national significant number: 5XXXXXXXX (9 digits, mobile).
  if s ~ '^5[0-9]{8}$' then
    return '+966' || s;
  end if;

  return null;
end;
$$;

-- Strict variant used at write time: raises instead of silently returning NULL.
create or replace function app.require_phone_e164(p_input text) returns text
language plpgsql immutable as $$
declare
  v text;
begin
  v := app.normalize_phone_e164(p_input);
  if v is null then
    raise exception 'INVALID_PHONE: % is not a valid KSA mobile number', p_input
      using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Money normalization: any human string -> integer halalas (1 SAR = 100 halalas).
-- Strips currency symbols, thousands separators, Arabic digits. Never returns a float.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_amount_halalas(p_input text) returns bigint
language plpgsql immutable as $$
declare
  s text;
  v numeric;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := replace(s, '٫', '.');                    -- Arabic decimal separator
  s := regexp_replace(s, '[^0-9.\-]', '', 'g'); -- drop currency, commas, spaces

  if s = '' or s = '-' or s = '.' then
    return null;
  end if;

  v := s::numeric;
  return round(v * 100)::bigint;
end;
$$;

-- ---------------------------------------------------------------------------
-- Date normalization for import: accepts ISO, dd/mm/yyyy, yyyy/mm/dd, Arabic digits.
-- Gregorian only; Hijri parsing is a Deferred Decision (SCHEMA.md).
-- ---------------------------------------------------------------------------
create or replace function app.normalize_date(p_input text) returns date
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := trim(app.fold_digits(p_input));
  s := replace(replace(s, '.', '/'), '\', '/');
  s := replace(s, '-', '/');

  if s ~ '^\d{4}/\d{1,2}/\d{1,2}$' then
    return to_date(s, 'YYYY/MM/DD');
  elsif s ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    return to_date(s, 'DD/MM/YYYY');
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared updated_at maintenance.
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
