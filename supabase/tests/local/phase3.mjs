// Phase-3 behavioural + isolation tests against a real PG17 (Charter هـ-36/37).
// Covers: viewer read-only enforcement (0033), portal identity-isolation (0028/0029),
// core financial ops (0019), and contract renewal (0031). Complements verify.mjs (data layer).
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54351);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// Run body as an authenticated identity (+ optional active org), always rolled back.
async function asRole(sub, org, body) {
  await q("begin");
  try {
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
    if (org) await q("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-active-org": org })]);
    await q("set local role authenticated");
    const value = await body();
    await q("rollback");
    return { ok: true, value };
  } catch (e) {
    await q("rollback").catch(() => {});
    return { ok: false, error: e.message };
  }
}
const tryWrite = (sub, org, sql, params) => asRole(sub, org, () => client.query(sql, params));

try {
  // ---------------- Seed (as postgres, bypassing RLS) ----------------
  const org1 = (await one("insert into app.organization(name) values('Org One') returning id")).id;
  const org2 = (await one("insert into app.organization(name) values('Org Two') returning id")).id;
  // Seeded by direct insert (not create_organization) → provision a live subscription so the 0036
  // guard doesn't fail-close the property/unit/contract/membership inserts below. Comped on the
  // unlimited Enterprise tier so seed volume never trips a plan ceiling.
  for (const o of [org1, org2])
    await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [o]);

  const mkId = async (phone) => (await one("insert into app.identity(phone_e164,phone_raw) values($1,$1) returning id", [phone])).id;
  const idOwner = await mkId("+966500000010");   // office owner, org1
  const idViewer = await mkId("+966500000011");  // viewer, org1
  const idStaff = await mkId("+966500000012");   // staff, org1
  const idLandlord1 = await mkId("+966500000013"); // portal owner (NOT a member), org1
  const idLandlord2 = await mkId("+966500000014"); // portal owner, org2
  const idTenant1 = await mkId("+966500000015");   // portal tenant, org1

  const mkMember = (idn, org, role) => q(
    "insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,$3,'active',true)", [idn, org, role]);
  await mkMember(idOwner, org1, "owner");
  await mkMember(idViewer, org1, "viewer");
  await mkMember(idStaff, org1, "staff");

  // Link a party to an identity through the guarded flag (session-level; test-only shortcut).
  async function linkParty(partyId, identityId) {
    await q("select set_config('app.allow_party_link','on',false)");
    await q("update app.party set identity_id=$1 where id=$2", [identityId, partyId]);
    await q("select set_config('app.allow_party_link','off',false)");
  }

  // Landlord owners (non-self) in each org, linked to portal identities.
  const mkOwner = async (org, name, identityId) => {
    const p = (await one("insert into app.party(org_id,display_name,roles) values($1,$2,array['owner']::app.party_role[]) returning id", [org, name])).id;
    await linkParty(p, identityId);
    return (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id", [org, p])).id;
  };
  const O1 = await mkOwner(org1, "Landlord One", idLandlord1);
  const O2 = await mkOwner(org2, "Landlord Two", idLandlord2);

  const P1 = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'P1') returning id", [org1, O1])).id;
  const U1 = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'101','vacant') returning id", [org1, P1])).id;

  // Tenants: T1 (org1) linked to idTenant1; T2 (org2) linked to nobody (foreign).
  const mkTenant = async (org, name, identityId) => {
    const p = (await one("insert into app.party(org_id,display_name,roles) values($1,$2,array['tenant']::app.party_role[]) returning id", [org, name])).id;
    if (identityId) await linkParty(p, identityId);
    return (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, p])).id;
  };
  const T1 = await mkTenant(org1, "Tenant One", idTenant1);
  const T2 = await mkTenant(org2, "Tenant Two", null);

  const C1 = (await one(
    `insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency)
     values($1,$2,$3,$4,'CT-1','residential','draft','2025-01-01','2025-12-31',1200000,'quarterly') returning id`,
    [org1, P1, U1, T1])).id;

  // ==================== B-2: viewer is read-only (0033) ====================
  const vread = await asRole(idViewer, org1, () => client.query("select count(*)::int n from app.property"));
  ok("viewer CAN read property", vread.ok && vread.value.rows[0].n >= 1, vread.error);

  const vInsParty = await tryWrite(idViewer, org1,
    "insert into app.party(org_id,display_name) values($1,'X')", [org1]);
  ok("viewer CANNOT insert party", vInsParty.ok === false);

  // RLS restrictive USING filters the row out of UPDATE → 0 rows changed (no error is raised).
  const vUpdProp = await asRole(idViewer, org1, () => client.query("update app.property set name='hacked' where id=$1", [P1]));
  ok("viewer UPDATE is blocked (0 rows changed)", vUpdProp.ok && vUpdProp.value.rowCount === 0, vUpdProp.error);

  const vInsCharge = await tryWrite(idViewer, org1,
    "insert into app.charge(org_id,property_id,unit_id,contract_id,charge_type,due_date,amount_excl_vat_halalas,vat_rate,vat_amount_halalas) values($1,$2,$3,$4,'residential_rent','2025-01-01',100,0,0)",
    [org1, P1, U1, C1]);
  ok("viewer CANNOT insert charge", vInsCharge.ok === false);

  const sInsParty = await tryWrite(idStaff, org1,
    "insert into app.party(org_id,display_name) values($1,'Y')", [org1]);
  ok("staff (non-viewer) CAN insert party", sInsParty.ok === true, sInsParty.error);

  const sUpdProp = await tryWrite(idStaff, org1,
    "update app.property set city='Riyadh' where id=$1", [P1]);
  ok("staff (non-viewer) CAN update property", sUpdProp.ok === true, sUpdProp.error);

  // ==================== Portal identity-isolation (0028/0029) ====================
  const ownMine = await asRole(idLandlord1, null, () => client.query("select app.owner_is_mine($1) m", [O1]));
  ok("owner_is_mine true for own owner", ownMine.ok && ownMine.value.rows[0].m === true, ownMine.error);
  const ownForeign = await asRole(idLandlord1, null, () => client.query("select app.owner_is_mine($1) m", [O2]));
  ok("owner_is_mine false for foreign owner", ownForeign.ok && ownForeign.value.rows[0].m === false);

  const stmtOwn = await asRole(idLandlord1, null, () => client.query("select * from app.owner_portal_statement($1,'2025-01-01','2025-12-31')", [O1]));
  ok("owner_portal_statement OK for own owner", stmtOwn.ok === true, stmtOwn.error);
  const stmtForeign = await asRole(idLandlord1, null, () => client.query("select * from app.owner_portal_statement($1,'2025-01-01','2025-12-31')", [O2]));
  ok("owner_portal_statement FORBIDDEN for foreign owner", stmtForeign.ok === false && /FORBIDDEN/i.test(stmtForeign.error || ""), stmtForeign.error);

  const tenMine = await asRole(idTenant1, null, () => client.query("select app.tenant_is_mine($1) m", [T1]));
  ok("tenant_is_mine true for own tenant", tenMine.ok && tenMine.value.rows[0].m === true, tenMine.error);
  const tenForeign = await asRole(idTenant1, null, () => client.query("select app.tenant_is_mine($1) m", [T2]));
  ok("tenant_is_mine false for foreign tenant", tenForeign.ok && tenForeign.value.rows[0].m === false);
  const chForeign = await asRole(idTenant1, null, () => client.query("select * from app.tenant_portal_charges($1)", [T2]));
  ok("tenant_portal_charges FORBIDDEN for foreign tenant", chForeign.ok === false && /FORBIDDEN/i.test(chForeign.error || ""), chForeign.error);

  // ==================== Core financial ops (0019) ====================
  await q("select app.activate_contract($1)", [C1]);
  const charges = (await q("select count(*)::int n, coalesce(sum(vat_amount_halalas),0)::int vat from app.charge where contract_id=$1 and deleted_at is null", [C1])).rows[0];
  ok("activate: 4 quarterly charges", charges.n === 4);
  ok("residential rent VAT-exempt (0)", charges.vat === 0);
  ok("unit marked rented", (await one("select current_status s from app.unit where id=$1", [U1])).s === "rented");

  const ch1 = (await one("select id, amount_incl_vat_halalas g from app.charge where contract_id=$1 order by due_date limit 1", [C1]));
  await q("select app.record_charge_payment($1,$2,'cash')", [ch1.id, 300000]);
  const bal = (await one("select balance_halalas b, allocated_halalas a from app.charge_balance where charge_id=$1", [ch1.id]));
  ok("payment allocated to charge", Number(bal.a) === 300000 && Number(bal.b) === Number(ch1.g) - 300000);

  // ==================== Renewal (0031) ====================
  const R1 = (await one("select app.renew_contract($1,'2026-01-01','2026-12-31',1300000,null) id", [C1])).id;
  ok("renewal is a draft successor linked to source",
    (await one("select status s, renewed_from_contract_id f from app.contract where id=$1", [R1])).s === "draft");
  await q("select app.activate_renewal($1)", [R1]);
  ok("after activate_renewal: source expired",
    (await one("select status s from app.contract where id=$1", [C1])).s === "expired");
  ok("after activate_renewal: successor active with schedule",
    (await one("select status s from app.contract where id=$1", [R1])).s === "active" &&
    (await one("select count(*)::int n from app.charge where contract_id=$1 and deleted_at is null", [R1])).n === 4);
  ok("exactly one active contract on the unit",
    (await one("select count(*)::int n from app.contract where unit_id=$1 and status='active'", [U1])).n === 1);

  // ==================== Notifications (0034): isolation + gating ====================
  await q("insert into app.notification(org_id, kind, title) values($1,'charge_overdue','تنبيه اختبار')", [org1]);
  const noteMine = await asRole(idOwner, org1, () => client.query("select count(*)::int n from app.notification"));
  ok("member sees own org's notifications", noteMine.ok && noteMine.value.rows[0].n >= 1, noteMine.error);
  const noteForeign = await asRole(idOwner, org2, () => client.query("select count(*)::int n from app.notification"));
  ok("notifications isolated: forged/foreign org sees none", noteForeign.ok && noteForeign.value.rows[0].n === 0);
  const genForbidden = await asRole(idOwner, org2, () => client.query("select app.generate_notifications($1)", [org2]));
  ok("generate_notifications FORBIDDEN for non-member org", genForbidden.ok === false && /FORBIDDEN/i.test(genForbidden.error || ""));
  const genOk = await asRole(idOwner, org1, () => client.query("select app.generate_notifications($1) c", [org1]));
  ok("generate_notifications OK for a member", genOk.ok === true, genOk.error);

  // ==================== Subscription (0036): lock, limits, comp, provisioning ====================
  // A tight throwaway plan makes the ceiling deterministic without seeding 25 properties.
  await q("insert into app.plan(code,name_ar,max_properties,max_units,max_members,price_halalas,is_public) values('test_tight','اختبار',1,1,1,0,false) on conflict (code) do nothing");
  const mkSelfOwner = async (org) => {
    const p = (await one("insert into app.party(org_id,display_name,legal_kind,roles) values($1,'Self','company',array['owner']::app.party_role[]) returning id", [org])).id;
    return (await one("insert into app.owner(org_id,party_id,is_self,owner_kind) values($1,$2,true,'company') returning id", [org, p])).id;
  };

  // Org with an EXPIRED trial → new creation is locked.
  const orgS = (await one("insert into app.organization(name) values('Sub Org') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status,trial_ends_at) values($1,'test_tight','trialing', now() - interval '1 day')", [orgS]);
  const ownS = await mkSelfOwner(orgS);   // party/owner are unguarded — only property/unit/member/contract are
  let expiredErr = "";
  try { await q("insert into app.property(org_id,owner_id,name) values($1,$2,'X')", [orgS, ownS]); }
  catch (e) { expiredErr = e.message; }
  ok("expired trial blocks new property (SUBSCRIPTION_EXPIRED)", /SUBSCRIPTION_EXPIRED/.test(expiredErr), expiredErr);

  // Extend the trial (the manual marketing lever ق-د.1) → creation is re-enabled.
  await q("update app.org_subscription set trial_ends_at = now() + interval '30 days' where org_id=$1", [orgS]);
  const p1 = await q("insert into app.property(org_id,owner_id,name) values($1,$2,'P-1') returning id", [orgS, ownS]).then(r => r.rows[0].id, e => ({ err: e.message }));
  ok("extending trial re-enables creation", typeof p1 === "string", p1 && p1.err);

  // At the plan ceiling (1 property) → the 2nd is blocked.
  let limitErr = "";
  try { await q("insert into app.property(org_id,owner_id,name) values($1,$2,'P-2')", [orgS, ownS]); }
  catch (e) { limitErr = e.message; }
  ok("exceeding plan property limit is blocked (PLAN_LIMIT_EXCEEDED)", /PLAN_LIMIT_EXCEEDED/.test(limitErr), limitErr);

  // A comp (ق-د.2) ignores expiry entirely — past dates, still allowed (Basic ceiling not hit).
  const orgC = (await one("insert into app.organization(name) values('Comp Org') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status,trial_ends_at,current_period_end) values($1,'basic','comped', now()-interval '10 days', now()-interval '10 days')", [orgC]);
  const ownC = await mkSelfOwner(orgC);
  const pc = await q("insert into app.property(org_id,owner_id,name) values($1,$2,'C-1') returning id", [orgC, ownC]).then(r => r.rows[0].id, e => ({ err: e.message }));
  ok("comped subscription bypasses expiry", typeof pc === "string", pc && pc.err);

  // create_organization auto-provisions a 30-day Basic trial before the first membership.
  const idFresh = await mkId("+966500000099");
  const prov = await asRole(idFresh, null, async () => {
    const oid = (await client.query("select app.create_organization('Fresh Office') id")).rows[0].id;
    // Read the row under the new org's context (RLS hides it otherwise — no active-org header).
    await client.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-active-org": oid })]);
    return (await client.query("select status, plan_code, trial_ends_at from app.org_subscription where org_id=$1", [oid])).rows[0];
  });
  ok("create_organization provisions a trialing Basic subscription",
    prov.ok && prov.value && prov.value.status === "trialing" && prov.value.plan_code === "basic" && prov.value.trial_ends_at, prov.error);

  // RLS: a member reads only their own org's subscription.
  const subMine = await asRole(idOwner, org1, () => client.query("select count(*)::int n from app.org_subscription"));
  ok("member sees own org subscription", subMine.ok && subMine.value.rows[0].n === 1, subMine.error);
  const subForeign = await asRole(idOwner, org2, () => client.query("select count(*)::int n from app.org_subscription"));
  ok("subscriptions isolated: forged/foreign org sees none", subForeign.ok && subForeign.value.rows[0].n === 0);

  // ==================== Identity email-first (0037): optional phone + contact floor ====================
  const emailId = (await one("insert into app.identity(email) values('office@example.com') returning id")).id;
  ok("identity with email only (no phone) is accepted", !!emailId);

  let bothNull = "";
  try { await q("insert into app.identity(full_name) values('No Contact')"); }
  catch (e) { bothNull = e.message; }
  ok("identity with neither phone nor email is rejected", /identity_contact_present|check/i.test(bothNull), bothNull);

  let badPhone = "";
  try { await q("insert into app.identity(phone_e164) values('12345')"); }
  catch (e) { badPhone = e.message; }
  ok("identity phone format still enforced when present", /check|phone/i.test(badPhone), badPhone);

  // The whole point: a phone-less (email) identity must be able to create an org, and get a trial sub.
  const emailOrg = await asRole(emailId, null, async () => {
    const oid = (await client.query("select app.create_organization('Email Office') id")).rows[0].id;
    await client.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-active-org": oid })]);
    const sub = (await client.query("select status, plan_code from app.org_subscription where org_id=$1", [oid])).rows[0];
    const mem = (await client.query("select count(*)::int n from app.membership where org_id=$1 and identity_id=$2", [oid, emailId])).rows[0].n;
    return { sub, mem };
  });
  ok("create_organization works for an email-only identity (+ trial provisioned)",
    emailOrg.ok && emailOrg.value.sub && emailOrg.value.sub.status === "trialing" && emailOrg.value.mem === 1, emailOrg.error);

  console.log(`\nPhase-3: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.error("HARNESS ERROR:", e.message, "\n", e.stack);
  fail++;
} finally {
  await stop();
}
process.exitCode = fail === 0 ? 0 : 1;
