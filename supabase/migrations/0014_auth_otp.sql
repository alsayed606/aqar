-- 0014_auth_otp.sql
-- Phone-first OTP: cryptographic 6-digit codes, hashed+peppered storage, single-use, 5-minute expiry,
-- per phone/IP/device rate limiting, escalating lockout, and account-enumeration-safe uniform
-- responses. SECURITY DEFINER (these run pre-auth as anon and must reach the auth-layer tables). §4.

-- Server-side pepper. In production set: ALTER DATABASE <db> SET app.otp_pepper = '<secret>';
create or replace function app.otp_pepper() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.otp_pepper', true), ''), 'dev-only-pepper-change-me');
$$;

-- Cryptographic 6-digit code (NOT Math.random / random()). §4.
create or replace function app.gen_otp_code() returns text
language plpgsql volatile set search_path = app, extensions, pg_temp as $$
declare
  b bytea := gen_random_bytes(4);
  n bigint;
begin
  n := (get_byte(b,0)::bigint * 16777216)
     + (get_byte(b,1)::bigint * 65536)
     + (get_byte(b,2)::bigint * 256)
     + get_byte(b,3)::bigint;
  return lpad((n % 1000000)::text, 6, '0');
end;
$$;

-- Rate gate: at most 5 requests per phone / IP / device in a rolling 15 minutes,
-- and an escalating lock when recent verify failures pile up. §4.
create or replace function app.otp_rate_ok(p_phone text, p_ip inet, p_device text) returns boolean
language sql stable security definer set search_path = app, extensions, pg_temp as $$
  select
    -- the current request has already been recorded, so <= 5 allows exactly 5 sends per window
    (select count(*) from app.auth_attempt
       where phone_e164 = p_phone and kind = 'otp_request'
         and created_at > now() - interval '15 minutes') <= 5
    and (p_ip is null or (select count(*) from app.auth_attempt
       where ip = p_ip and kind = 'otp_request'
         and created_at > now() - interval '15 minutes') < 20)
    and (p_device is null or (select count(*) from app.auth_attempt
       where device_fingerprint = p_device and kind = 'otp_request'
         and created_at > now() - interval '15 minutes') < 10)
    -- escalating lock: too many recent failures for this phone → cool down
    and (select count(*) from app.auth_attempt
       where phone_e164 = p_phone and kind = 'otp_verify_fail'
         and created_at > now() - interval '15 minutes') < 10;
$$;

-- ---------------------------------------------------------------------------
-- request_otp — ALWAYS returns void (uniform). Whether the phone maps to an existing identity or
-- not, behaviour is identical: no account enumeration. §4, §10 tests 8 & 9.
-- When rate-limited, records the attempt but creates no challenge and enqueues no SMS.
-- ---------------------------------------------------------------------------
create or replace function app.request_otp(
  p_phone_input text,
  p_ip inet default null,
  p_device text default null,
  p_purpose text default 'login'
) returns void
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text := app.normalize_phone_e164(p_phone_input);
  v_code  text;
begin
  -- Record the attempt regardless (feeds rate limiting) — uniform work either way.
  insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
  values (v_phone, p_ip, p_device, 'otp_request');

  -- Invalid phone or throttled → stop silently (still returns void). No leak.
  if v_phone is null then
    return;
  end if;
  if not app.otp_rate_ok(v_phone, p_ip, p_device) then
    return;
  end if;

  v_code := app.gen_otp_code();

  insert into app.otp_challenge (phone_e164, code_hash, purpose, ip, device_fingerprint, expires_at)
  values (
    v_phone,
    encode(digest(v_code || app.otp_pepper(), 'sha256'), 'hex'),
    p_purpose, p_ip, p_device,
    now() + interval '5 minutes'
  );

  -- Hand the rendered message to the swappable provider boundary.
  insert into app.sms_outbox (phone_e164, body)
  values (v_phone, 'رمز الدخول: ' || v_code || ' — صالح لمدة 5 دقائق.');
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_otp — returns the identity_id on success, NULL on ANY failure (uniform). On a successful
-- 'login' for a new number, the identity is created (phone-first registration). §4.
-- Enforces single-use, expiry, and max-attempts lockout. §10 test 7.
-- ---------------------------------------------------------------------------
create or replace function app.verify_otp(
  p_phone_input text,
  p_code text,
  p_ip inet default null,
  p_device text default null,
  p_purpose text default 'login'
) returns uuid
language plpgsql security definer set search_path = app, extensions, pg_temp as $$
declare
  v_phone text := app.normalize_phone_e164(p_phone_input);
  v_ch    app.otp_challenge;
  v_id    uuid;
begin
  if v_phone is null then
    return null;
  end if;

  select * into v_ch
  from app.otp_challenge
  where phone_e164 = v_phone
    and purpose = p_purpose
    and consumed_at is null
    and expires_at > now()
    and attempts < max_attempts
  order by created_at desc
  limit 1;

  if v_ch.id is null then
    insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
    values (v_phone, p_ip, p_device, 'otp_verify_fail');
    return null;   -- no valid challenge (expired / consumed / locked / never requested)
  end if;

  if v_ch.code_hash <> encode(digest(coalesce(p_code, '') || app.otp_pepper(), 'sha256'), 'hex') then
    update app.otp_challenge set attempts = attempts + 1 where id = v_ch.id;
    insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
    values (v_phone, p_ip, p_device, 'otp_verify_fail');
    return null;   -- wrong code
  end if;

  -- Success: consume single-use, resolve/create identity.
  update app.otp_challenge set consumed_at = now() where id = v_ch.id;

  select id into v_id from app.identity where phone_e164 = v_phone;
  if v_id is null and p_purpose = 'login' then
    insert into app.identity (phone_e164, phone_raw) values (v_phone, p_phone_input)
    returning id into v_id;
    insert into app.auth_method (identity_id, method) values (v_id, 'phone_otp');
  end if;

  insert into app.auth_attempt (phone_e164, ip, device_fingerprint, kind)
  values (v_phone, p_ip, p_device, 'otp_verify_ok');
  return v_id;
end;
$$;

revoke all on function app.request_otp(text, inet, text, text) from public;
revoke all on function app.verify_otp(text, text, inet, text, text) from public;
grant execute on function app.request_otp(text, inet, text, text)      to anon, authenticated, service_role;
grant execute on function app.verify_otp(text, text, inet, text, text) to anon, authenticated, service_role;
