-- 0032_drop_legacy_otp.sql
-- Sprint B / هـ-35, مر-19: remove the superseded custom phone-OTP + custom-session subsystem.
-- Since 0017 the live app authenticates via Supabase Auth (GoTrue) phone OTP; the objects below
-- (defined in 0004/0014) are dead — zero references in app/lib, and 0017's auth path does not use
-- them. `app.identity` is CORE and is KEPT. Idempotent (IF EXISTS); safe on live + fresh DB.

-- Functions first — they reference the auth-layer tables.
drop function if exists app.request_otp(text, inet, text, text);
drop function if exists app.verify_otp(text, text, inet, text, text);
drop function if exists app.otp_rate_ok(text, inet, text);
drop function if exists app.gen_otp_code();
drop function if exists app.otp_pepper();

-- Tables — CASCADE also drops their RLS policies, indexes, updated_at triggers, grants, and FKs.
-- None of the five is referenced by a surviving object. `identity` (the FK parent) is untouched.
drop table if exists app.otp_challenge cascade;
drop table if exists app.auth_attempt  cascade;
drop table if exists app.sms_outbox    cascade;
drop table if exists app.session       cascade;
drop table if exists app.auth_method   cascade;

-- The enum was used only by app.auth_method.method — now orphaned.
drop type if exists app.auth_method_type;
