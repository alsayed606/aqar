-- 02_auth.sql — pgTAP. Phone normalization, OTP lifecycle, rate limit, enumeration, no-auto-link
-- (§10 tests 6–10). Run: supabase test db
begin;
select plan(12);

-- ============ Test 6: phone normalization ============
select is(app.normalize_phone_e164('0501234567'),      '+966501234567', 'T6: 05… normalizes');
select is(app.normalize_phone_e164('٠٥٠١٢٣٤٥٦٧'),      '+966501234567', 'T6: Arabic-Indic digits normalize');
select is(app.normalize_phone_e164('966501234567'),    '+966501234567', 'T6: 966… normalizes');
select is(app.normalize_phone_e164('+966 50 123 4567'),'+966501234567', 'T6: +966 with spaces normalizes');
select is(app.normalize_phone_e164('+966-50-123-4567'),'+966501234567', 'T6: dashes normalize');
select is(app.normalize_phone_e164('12345'),           null::text,      'T6: invalid number rejected');

-- ============ Test 9: no account enumeration (identical observable effect) ============
insert into app.identity(phone_e164) values ('+966555000001');   -- existing
select app.request_otp('+966555000001');                          -- existing
select app.request_otp('+966555000009');                          -- non-existing
select is(
  (select count(*)::int from app.sms_outbox where phone_e164='+966555000001'),
  (select count(*)::int from app.sms_outbox where phone_e164='+966555000009'),
  'T9: request_otp behaves identically for existing vs non-existing number');

-- ============ Test 7: OTP single-use + expiry ============
-- Fabricate a known challenge (bypassing SMS) to assert verify semantics deterministically.
insert into app.otp_challenge(phone_e164, code_hash, purpose, expires_at)
values ('+966555000002', encode(extensions.digest('123456'||app.otp_pepper(),'sha256'),'hex'), 'login', now()+interval '5 minutes');
select isnt(app.verify_otp('+966555000002','123456'), null::uuid, 'T7: correct OTP verifies once');
select is(  app.verify_otp('+966555000002','123456'), null::uuid, 'T7: reused OTP is rejected (single-use)');

insert into app.otp_challenge(phone_e164, code_hash, purpose, expires_at)
values ('+966555000003', encode(extensions.digest('654321'||app.otp_pepper(),'sha256'),'hex'), 'login', now()-interval '1 minute');
select is(app.verify_otp('+966555000003','654321'), null::uuid, 'T7: expired OTP is rejected');

-- ============ Test 8: rate limit caps sends at 5 per window ============
do $$ begin for i in 1..8 loop perform app.request_otp('+966555000004'); end loop; end $$;
select is((select count(*)::int from app.sms_outbox where phone_e164='+966555000004'), 5,
          'T8: rate limit caps OTP sends at 5 per 15-min window');

-- ============ Test 10: no auto-link Party<->Identity by phone match ============
insert into app.organization(id,name) values ('00000000-0000-0000-0000-0000000000a9','Org9');
insert into app.identity(id,phone_e164) values ('00000000-0000-0000-0000-0000000000b9','+966555000005');
insert into app.party(id,org_id,display_name,phone_e164)
  values ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-0000000000a9','Owner Nine','+966555000005');
-- Direct link by matching phone is structurally blocked (no sanctioned path invoked).
select throws_ok(
  $$update app.party set identity_id='00000000-0000-0000-0000-0000000000b9'
    where id='00000000-0000-0000-0000-0000000000d9'$$,
  null, null, 'T10: setting party.identity_id without an invitation is blocked');

select * from finish();
rollback;
