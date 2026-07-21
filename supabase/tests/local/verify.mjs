// Behavioural verification of the data layer against a real PG17.
// Mirrors the 13 mandatory tests from the spec (§10) plus import round-trip.
import { bootWithMigrations } from './_pgutil.mjs';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
async function expectThrow(name, fn, codeOrMsg) {
  try { await fn(); fail++; console.log('  FAIL  ' + name + '  -> expected error, none thrown'); }
  catch (e) {
    const good = !codeOrMsg || (e.message && e.message.includes(codeOrMsg));
    if (good) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + '  -> got: ' + e.message); }
  }
}

async function runAs(client, sub, org, body) {
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })]);
    if (org !== undefined) await client.query("select set_config('request.headers', $1, true)", [JSON.stringify({ 'x-active-org': org })]);
    await client.query('set local role authenticated');
    return await body();
  } finally {
    await client.query('rollback');
  }
}

const { client, stop } = await bootWithMigrations(54350);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

try {
  // ---------------- Seed (as postgres, bypassing RLS) ----------------
  const org1 = (await one("insert into app.organization(name) values('Office One') returning id")).id;
  const org2 = (await one("insert into app.organization(name) values('Office Two') returning id")).id;

  const mkIdentity = async (phone) => (await one(
    "insert into app.identity(phone_e164, phone_raw) values($1,$1) returning id", [phone])).id;
  const idA = await mkIdentity('+966500000001'); // owner org1
  const idB = await mkIdentity('+966500000002'); // owner org2
  const idC = await mkIdentity('+966500000003'); // member of BOTH
  const idS = await mkIdentity('+966500000004'); // scoped staff org1

  const mkMember = (idn, org, role, scopeAll = true) => q(
    "insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,$3,'active',$4)",
    [idn, org, role, scopeAll]);
  await mkMember(idA, org1, 'owner');
  await mkMember(idB, org2, 'owner');
  await mkMember(idC, org1, 'manager');
  await mkMember(idC, org2, 'manager');
  const memS = (await one(
    "insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'staff','active',false) returning id",
    [idS, org1])).id;

  // Self owners + parties for each org
  const mkSelfOwner = async (org, name) => {
    const p = (await one("insert into app.party(org_id,display_name,legal_kind,roles) values($1,$2,'company',array['owner']::app.party_role[]) returning id", [org, name])).id;
    return (await one("insert into app.owner(org_id,party_id,is_self,owner_kind) values($1,$2,true,'company') returning id", [org, p])).id;
  };
  const own1 = await mkSelfOwner(org1, 'Office One');
  const own2 = await mkSelfOwner(org2, 'Office Two');

  // Properties: org1 has P1 (scoped) and P2 (not scoped); org2 has P3
  const P1 = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'P1-Riyadh') returning id", [org1, own1])).id;
  const P2 = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'P2-Jeddah') returning id", [org1, own1])).id;
  const P3 = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'P3-Dammam') returning id", [org2, own2])).id;
  // Scope staff S to P1 only
  await q("insert into app.membership_property_scope(membership_id,property_id) values($1,$2)", [memS, P1]);

  // Units, tenant, contract for financial tests (org1/P1)
  const U1 = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'101','rented') returning id", [org1, P1])).id;
  const tParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'Tenant Ahmad',array['tenant']::app.party_role[]) returning id", [org1])).id;
  const T1 = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org1, tParty])).id;
  const C1 = (await one(
    `insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,start_date,end_date,annual_rent_halalas,status)
     values($1,$2,$3,$4,'CT-1', current_date - 400, current_date + 100, 12000000,'active') returning id`,
    [org1, P1, U1, T1])).id;

  // ================= 6. Phone normalization =================
  const variants = ['0501234567', '٠٥٠١٢٣٤٥٦٧', '966501234567', '+966 50 123 4567', '+966-50-123-4567', '501234567', '00966501234567'];
  let normSet = new Set();
  for (const v of variants) normSet.add((await one('select app.normalize_phone_e164($1) n', [v])).n);
  ok('06 phone normalization: all variants collapse to one E.164', normSet.size === 1 && normSet.has('+966501234567'), [...normSet].join(','));
  ok('06 invalid phone rejected', (await one("select app.normalize_phone_e164('12345') n")).n === null);

  // ================= 13. No float in financial fields =================
  const floats = await one(`select count(*)::int c from information_schema.columns
     where table_schema='app' and data_type in ('double precision','real')`);
  ok('13 no float/double columns anywhere in app schema', floats.c === 0, 'found ' + floats.c);

  // ================= 1. Multi-org isolation =================
  const c_org1_props = await runAs(client, idC, org1, async () =>
    (await q("select name from app.property order by name")).rows.map(r => r.name));
  const c_org2_props = await runAs(client, idC, org2, async () =>
    (await q("select name from app.property order by name")).rows.map(r => r.name));
  ok('01 member sees only org1 rows under org1 context', JSON.stringify(c_org1_props) === JSON.stringify(['P1-Riyadh', 'P2-Jeddah']), c_org1_props.join());
  ok('01 same member sees only org2 rows under org2 context', JSON.stringify(c_org2_props) === JSON.stringify(['P3-Dammam']), c_org2_props.join());
  ok('01 no leakage of org2 data into org1 view', !c_org1_props.includes('P3-Dammam'));

  // ================= 3. Forged org_id rejected =================
  const a_forge = await runAs(client, idA, org2 /* A is NOT a member of org2 */, async () =>
    (await q("select count(*)::int c from app.property")).rows[0].c);
  ok('03 forged active-org (non-member) yields zero rows', a_forge === 0, 'got ' + a_forge);
  await expectThrow('03 forged active-org write is rejected', () =>
    runAs(client, idA, org2, async () =>
      q("insert into app.property(org_id,owner_id,name) values($1,$2,'HACK')", [org2, own2])));

  // ================= 4. property_scope confinement =================
  const s_props = await runAs(client, idS, org1, async () =>
    (await q("select name from app.property order by name")).rows.map(r => r.name));
  ok('04 scoped staff sees only in-scope property', JSON.stringify(s_props) === JSON.stringify(['P1-Riyadh']), s_props.join());
  const s_seesP2 = await runAs(client, idS, org1, async () =>
    (await q("select count(*)::int c from app.property where id=$1", [P2])).rows[0].c);
  ok('04 scoped staff cannot see out-of-scope property by id', s_seesP2 === 0);

  // ================= 5. Cross-org / cross-scope R/W all fail =================
  const c_reads_org2_prop_under_org1 = await runAs(client, idC, org1, async () =>
    (await q("select count(*)::int c from app.property where id=$1", [P3])).rows[0].c);
  ok('05 cannot read another org row by id under wrong context', c_reads_org2_prop_under_org1 === 0);
  await expectThrow('05 cannot insert unit into out-of-scope property', () =>
    runAs(client, idS, org1, async () =>
      q("insert into app.unit(org_id,property_id,unit_number) values($1,$2,'X')", [org1, P2])));
  const s_update_p2 = await runAs(client, idS, org1, async () =>
    (await q("update app.property set city='x' where id=$1", [P2])).rowCount);
  ok('05 cross-scope update affects zero rows', s_update_p2 === 0);

  // ================= 2. Revoked membership loses access immediately =================
  await client.query("update app.membership set status='revoked' where identity_id=$1 and org_id=$2", [idC, org1]);
  const c_after_revoke = await runAs(client, idC, org1, async () =>
    (await q("select count(*)::int c from app.property")).rows[0].c);
  ok('02 revoked membership immediately loses read access', c_after_revoke === 0, 'got ' + c_after_revoke);
  await expectThrow('02 revoked membership immediately loses write access', () =>
    runAs(client, idC, org1, async () =>
      q("insert into app.property(org_id,owner_id,name) values($1,$2,'nope')", [org1, own1])));
  await client.query("update app.membership set status='active' where identity_id=$1 and org_id=$2", [idC, org1]);

  // ================= 10. No auto-link Party<->Identity by phone =================
  await expectThrow('10 setting party.identity_id without invitation is blocked', () =>
    q("update app.party set identity_id=$1 where id=$2", [idA, tParty]), 'PARTY_LINK_FORBIDDEN');
  // sanctioned path works: create an invitation and link via RPC
  const tok = 'invite-token-123';
  await q(`insert into app.invitation(org_id,phone_e164,role,token_hash,expires_at)
           values($1,'+966500000009','viewer', encode(extensions.digest($2,'sha256'),'hex'), now()+interval '7 days')`, [org1, tok]);
  // sanctioned link must persist, so commit this one (runAs rolls back by design)
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: idA, role: 'authenticated' })]);
  await client.query("select set_config('request.headers', $1, true)", [JSON.stringify({ 'x-active-org': org1 })]);
  await client.query('set local role authenticated');
  await client.query('select app.link_party_identity($1,$2)', [tParty, tok]);
  await client.query('reset role');
  await client.query('commit');
  const linked = (await one("select identity_id from app.party where id=$1", [tParty])).identity_id;
  ok('10 sanctioned link via valid invitation token succeeds', linked === idA);

  // ================= 11. UPDATE on active contract rejected =================
  await expectThrow('11 UPDATE on active contract is rejected', () =>
    q("update app.contract set annual_rent_halalas=99999999 where id=$1", [C1]), 'CONTRACT_IMMUTABLE');
  const lifecycle = (await q("update app.contract set status='terminated', terminated_at=now() where id=$1", [C1])).rowCount;
  ok('11 lifecycle transition (terminate) on active contract is allowed', lifecycle === 1);
  await client.query("update app.contract set status='active', terminated_at=null where id=$1", [C1]);

  // ================= 12. Derived financial status =================
  // Charge A (overdue), Charge B (future) each gross 1,000,000 halalas (10,000 SAR)
  const chgA = (await one(`insert into app.charge(org_id,property_id,unit_id,contract_id,charge_type,due_date,amount_excl_vat_halalas)
     values($1,$2,$3,$4,'residential_rent', current_date - 10, 1000000) returning id`, [org1, P1, U1, C1])).id;
  const chgB = (await one(`insert into app.charge(org_id,property_id,unit_id,contract_id,charge_type,due_date,amount_excl_vat_halalas)
     values($1,$2,$3,$4,'residential_rent', current_date + 30, 1000000) returning id`, [org1, P1, U1, C1])).id;

  // partial payment 400,000 on A
  const payP = (await one("insert into app.payment(org_id,party_id,amount_halalas) values($1,$2,400000) returning id", [org1, tParty])).id;
  await q("insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values($1,$2,$3,400000)", [org1, payP, chgA]);
  const balA = await one("select balance_halalas, is_settled, is_overdue from app.charge_balance where charge_id=$1", [chgA]);
  ok('12 partial payment -> balance 600000, not settled, overdue', Number(balA.balance_halalas) === 600000 && !balA.is_settled && balA.is_overdue,
     JSON.stringify(balA));

  // overpayment: pay 1,500,000, allocate only up to gross 1,000,000 (cap enforced), rest is credit
  const payO = (await one("insert into app.payment(org_id,party_id,amount_halalas) values($1,$2,1500000) returning id", [org1, tParty])).id;
  await q("insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values($1,$2,$3,1000000)", [org1, payO, chgB]);
  await expectThrow('12 allocation cannot exceed charge gross', () =>
    q("insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values($1,$2,$3,1)", [org1, payO, chgB]), 'ALLOCATION_EXCEEDS_CHARGE');
  const balB = await one("select balance_halalas, is_settled from app.charge_balance where charge_id=$1", [chgB]);
  const payOstat = await one("select unallocated_halalas from app.payment_status where payment_id=$1", [payO]);
  ok('12 overpayment -> charge settled and 500000 credit remains on payment',
     Number(balB.balance_halalas) === 0 && balB.is_settled && Number(payOstat.unallocated_halalas) === 500000, JSON.stringify({ balB, payOstat }));

  // one payment covers two charges
  const chgC = (await one(`insert into app.charge(org_id,property_id,unit_id,contract_id,charge_type,due_date,amount_excl_vat_halalas)
     values($1,$2,$3,$4,'service_fee', current_date, 600000) returning id`, [org1, P1, U1, C1])).id;
  const chgD = (await one(`insert into app.charge(org_id,property_id,unit_id,contract_id,charge_type,due_date,amount_excl_vat_halalas)
     values($1,$2,$3,$4,'service_fee', current_date, 400000) returning id`, [org1, P1, U1, C1])).id;
  const payMulti = (await one("insert into app.payment(org_id,party_id,amount_halalas) values($1,$2,1000000) returning id", [org1, tParty])).id;
  await q("insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values($1,$2,$3,600000)", [org1, payMulti, chgC]);
  await q("insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values($1,$2,$3,400000)", [org1, payMulti, chgD]);
  const bothSettled = await one("select bool_and(is_settled) s from app.charge_balance where charge_id in ($1,$2)", [chgC, chgD]);
  ok('12 one payment settles two charges', bothSettled.s === true);
  await expectThrow('12 allocation cannot exceed payment total', () =>
    q("insert into app.payment_allocation(org_id,payment_id,charge_id,amount_halalas) values($1,$2,$3,1)", [org1, payMulti, chgA]), 'ALLOCATION_EXCEEDS_PAYMENT');

  // ================= 7,8,9 OTP =================
  const phoneNew = '+966555555501';       // brand new
  const phoneExisting = '+966500000001';  // idA exists
  // 9. enumeration: identical observable effect for existing vs non-existing
  await q('select app.request_otp($1,null,null)', [phoneNew]);
  await q('select app.request_otp($1,null,null)', [phoneExisting]);
  const smsNew = (await one("select count(*)::int c from app.sms_outbox where phone_e164=$1", [phoneNew])).c;
  const smsEx = (await one("select count(*)::int c from app.sms_outbox where phone_e164=$1", [phoneExisting])).c;
  ok('09 request_otp identical for existing vs non-existing (no enumeration)', smsNew === 1 && smsEx === 1, `${smsNew}/${smsEx}`);

  // 7. reuse + expiry
  const body = (await one("select body from app.sms_outbox where phone_e164=$1 order by created_at desc limit 1", [phoneNew])).body;
  const code = body.match(/(\d{6})/)[1];
  const v1 = (await one('select app.verify_otp($1,$2,null,null) id', [phoneNew, code])).id;
  ok('07 first verify_otp succeeds', v1 !== null);
  const v2 = (await one('select app.verify_otp($1,$2,null,null) id', [phoneNew, code])).id;
  ok('07 reused OTP is rejected (single-use)', v2 === null);
  // expiry
  const pExp = '+966555555502';
  await q(`insert into app.otp_challenge(phone_e164,code_hash,purpose,expires_at)
           values($1, encode(extensions.digest('654321'||app.otp_pepper(),'sha256'),'hex'),'login', now()-interval '1 minute')`, [pExp]);
  const vExp = (await one('select app.verify_otp($1,$2,null,null) id', [pExp, '654321'])).id;
  ok('07 expired OTP is rejected', vExp === null);

  // 8. rate limit -> exactly 5 sends per window
  const pRate = '+966555555503';
  for (let i = 0; i < 8; i++) await q('select app.request_otp($1,null,null)', [pRate]);
  const sends = (await one("select count(*)::int c from app.sms_outbox where phone_e164=$1", [pRate])).c;
  ok('08 rate limit caps sends at 5 per window', sends === 5, 'got ' + sends);

  // ================= Import round-trip (properties) =================
  const batch = (await one("insert into app.import_batch(org_id,kind,source_filename) values($1,'properties','props.xlsx') returning id", [org1])).id;
  await q(`insert into app.import_row(batch_id,org_id,row_number,raw) values
     ($1,$2,1, jsonb_build_object('اسم العقار','عقار الاستيراد','نوع العقار','تجاري','المدينة','الرياض')),
     ($1,$2,2, jsonb_build_object('اسم العقار','', 'المدينة','جدة'))`, [batch, org1]);
  await q('select app.import_validate($1)', [batch]);
  const bstat = await one("select total_rows,valid_rows,error_rows,status from app.import_batch where id=$1", [batch]);
  ok('IMPORT validate: 1 valid, 1 error row with per-field reason',
     bstat.total_rows === 2 && bstat.valid_rows === 1 && bstat.error_rows === 1 && bstat.status === 'validated', JSON.stringify(bstat));
  const errRow = await one("select errors from app.import_row where batch_id=$1 and row_number=2", [batch]);
  ok('IMPORT error row names the offending field', JSON.stringify(errRow.errors).includes('اسم العقار'));
  await q('select app.import_commit($1)', [batch]);
  const created = (await one("select count(*)::int c from app.property where org_id=$1 and name='عقار الاستيراد' and deleted_at is null", [org1])).c;
  ok('IMPORT commit creates only valid rows', created === 1);
  await q('select app.import_revert($1)', [batch]);
  const afterRevert = (await one("select count(*)::int c from app.property where org_id=$1 and name='عقار الاستيراد' and deleted_at is null", [org1])).c;
  ok('IMPORT revert soft-deletes the whole batch', afterRevert === 0);

  // ================= audit append-only =================
  await q("insert into app.audit_log(org_id,identity_id,action) values($1,$2,'test.event')", [org1, idA]);
  await expectThrow('AUDIT update blocked', () => q("update app.audit_log set action='x' where org_id=$1", [org1]), 'AUDIT_APPEND_ONLY');
  await expectThrow('AUDIT delete blocked', () => q("delete from app.audit_log where org_id=$1", [org1]), 'AUDIT_APPEND_ONLY');

  // ================= last-owner protection =================
  await expectThrow('LAST-OWNER cannot be revoked', () =>
    q("update app.membership set status='revoked' where identity_id=$1 and org_id=$2", [idA, org1]), 'LAST_OWNER_PROTECTED');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error('HARNESS ERROR:', e.message, '\n', e.stack);
  process.exitCode = 1;
} finally {
  await stop();
}
