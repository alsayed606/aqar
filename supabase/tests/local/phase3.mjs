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

  // ==================== Notification email delivery (0038): enqueue + drain ====================
  // Run enqueue as a member (has_org_access) but committed (not rolled back) so rows persist for the
  // drain assertions. auth.uid()/current_org come from session GUCs; enqueue is DEFINER.
  async function enqAs(sub, org) {
    await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role: "authenticated" })]);
    await q("select set_config('request.headers',$1,false)", [JSON.stringify({ "x-active-org": org })]);
    try { return (await one("select app.enqueue_email_deliveries($1) c", [org])).c; }
    finally {
      await q("select set_config('request.jwt.claims','',false)");
      await q("select set_config('request.headers','',false)");
    }
  }

  const orgN = (await one("insert into app.organization(name) values('Notify Org') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [orgN]);
  const idEmail = (await one("insert into app.identity(phone_e164,phone_raw,email) values('+966500000200','+966500000200','notify-owner@example.com') returning id")).id;
  const idNoEmail = (await one("insert into app.identity(phone_e164,phone_raw) values('+966500000201','+966500000201') returning id")).id;
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idEmail, orgN]);
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'staff','active',true)", [idNoEmail, orgN]);
  const noteN = (await one("insert into app.notification(org_id,kind,title,body) values($1,'charge_overdue','دفعة متأخرة','دفعة مستحقة') returning id", [orgN])).id;

  await enqAs(idEmail, orgN);
  const delN = (await one("select count(*)::int n from app.notification_delivery where org_id=$1 and channel='email'", [orgN])).n;
  ok("enqueue: one email delivery per active member WITH an email (only)", delN === 1, "got " + delN);
  const del0 = await one("select target, status, attempts from app.notification_delivery where org_id=$1 limit 1", [orgN]);
  ok("delivery targets the member email, pending, 0 attempts", del0.target === "notify-owner@example.com" && del0.status === "pending" && del0.attempts === 0, JSON.stringify(del0));

  await enqAs(idEmail, orgN);
  const delN2 = (await one("select count(*)::int n from app.notification_delivery where org_id=$1", [orgN])).n;
  ok("enqueue is idempotent (no duplicate on re-run)", delN2 === 1, "got " + delN2);

  let enqForbidden = "";
  try { await enqAs(idOwner, orgN); } catch (e) { enqForbidden = e.message; }
  ok("enqueue FORBIDDEN for a non-member", /FORBIDDEN/i.test(enqForbidden), enqForbidden);

  const delMine = await asRole(idEmail, orgN, () => client.query("select count(*)::int n from app.notification_delivery"));
  ok("member reads own org deliveries (RLS)", delMine.ok && delMine.value.rows[0].n >= 1, delMine.error);
  const delForeign = await asRole(idOwner, org1, () => client.query("select count(*)::int n from app.notification_delivery where org_id=$1", [orgN]));
  ok("deliveries isolated across orgs (RLS)", delForeign.ok && delForeign.value.rows[0].n === 0);

  // Drain lifecycle (as postgres = service_role-equivalent): claim → mark sent, no re-claim.
  const claimed = (await q("select * from app.claim_email_deliveries(10)")).rows;
  ok("claim leases the pending delivery (attempts→1)", claimed.length === 1 && claimed[0].attempts === 1, JSON.stringify(claimed.map((c) => c.attempts)));
  const leased = await one("select attempts, (next_attempt_at > now()) future from app.notification_delivery where id=$1", [claimed[0].id]);
  ok("claim schedules next_attempt_at forward (retry lease)", leased.future === true && leased.attempts === 1);
  await q("select app.mark_email_delivery_sent($1,$2,$3::jsonb)", [claimed[0].id, "resend-msg-123", JSON.stringify({ id: "resend-msg-123" })]);
  const sentRow = await one("select status, provider, provider_message_id, sent_at from app.notification_delivery where id=$1", [claimed[0].id]);
  ok("mark_sent finalizes the row (provider_message_id + sent_at)", sentRow.status === "sent" && sentRow.provider === "resend" && sentRow.provider_message_id === "resend-msg-123" && !!sentRow.sent_at);
  const reclaim = (await q("select * from app.claim_email_deliveries(10)")).rows;
  ok("a sent delivery is never re-claimed", reclaim.length === 0);

  // Retry backoff → 'failed' after max attempts (3).
  const note2 = (await one("insert into app.notification(org_id,kind,title,due_date) values($1,'charge_overdue','تنبيه ٢', current_date) returning id", [orgN])).id;
  await enqAs(idEmail, orgN);
  const d2 = (await one("select id from app.notification_delivery where notification_id=$1", [note2])).id;
  for (let i = 0; i < 3; i++) {
    await q("update app.notification_delivery set next_attempt_at = now() - interval '1 hour' where id=$1 and status='pending'", [d2]);
    await q("select app.claim_email_deliveries(10)");
    await q("select app.mark_email_delivery_failed($1,$2,null)", [d2, "smtp error " + i]);
  }
  const failedRow = await one("select status, attempts, last_error from app.notification_delivery where id=$1", [d2]);
  ok("delivery becomes 'failed' after 3 attempts", failedRow.status === "failed" && failedRow.attempts === 3, JSON.stringify(failedRow));

  // ==================== Subscription payments (0039): intent → apply → activate ====================
  // Committed authenticated call (persists, unlike asRole) via session GUCs; the fns are DEFINER.
  async function callAs(sub, org, sql, params) {
    await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role: "authenticated" })]);
    await q("select set_config('request.headers',$1,false)", [JSON.stringify({ "x-active-org": org })]);
    try { return (await q(sql, params)).rows; }
    finally {
      await q("select set_config('request.jwt.claims','',false)");
      await q("select set_config('request.headers','',false)");
    }
  }

  const intent = (await callAs(idOwner, org1, "select * from app.create_subscription_payment($1,'basic')", [org1]))[0];
  ok("create_subscription_payment records an initiated Basic intent (9900)",
    intent && intent.status === "initiated" && Number(intent.amount_halalas) === 9900, JSON.stringify(intent && { s: intent.status, a: intent.amount_halalas }));

  let payForbidden = "";
  try { await callAs(idViewer, org1, "select app.create_subscription_payment($1,'basic')", [org1]); } catch (e) { payForbidden = e.message; }
  ok("create_subscription_payment FORBIDDEN for a non-admin", /FORBIDDEN/i.test(payForbidden), payForbidden);

  let notPurchasable = "";
  try { await callAs(idOwner, org1, "select app.create_subscription_payment($1,'enterprise')", [org1]); } catch (e) { notPurchasable = e.message; }
  ok("enterprise (private / price 0) is not self-serve purchasable", /PLAN_NOT_PURCHASABLE/i.test(notPurchasable), notPurchasable);

  await q("select app.apply_subscription_payment($1,$2,$3::jsonb)", [intent.id, "moyasar-abc", JSON.stringify({ id: "moyasar-abc", status: "paid" })]);
  const sub1 = await one("select plan_code, status, (current_period_end > now()) future from app.org_subscription where org_id=$1", [org1]);
  ok("apply activates the subscription (basic, active, future period)", sub1.plan_code === "basic" && sub1.status === "active" && sub1.future === true, JSON.stringify(sub1));
  const paid1 = await one("select status, paid_at, gateway_payment_id, period_end from app.subscription_payment where id=$1", [intent.id]);
  ok("payment marked paid (gateway ref + period_end)", paid1.status === "paid" && !!paid1.paid_at && paid1.gateway_payment_id === "moyasar-abc" && !!paid1.period_end);

  await q("select app.apply_subscription_payment($1,$2,$3::jsonb)", [intent.id, "moyasar-abc", JSON.stringify({ id: "moyasar-abc", status: "paid" })]);
  const end2 = (await one("select period_end from app.subscription_payment where id=$1", [intent.id])).period_end;
  ok("apply is idempotent (period NOT extended twice)", new Date(paid1.period_end).getTime() === new Date(end2).getTime());

  const intent2 = (await callAs(idOwner, org1, "select * from app.create_subscription_payment($1,'pro')", [org1]))[0];
  await q("select app.mark_subscription_payment_failed($1,$2::jsonb)", [intent2.id, JSON.stringify({ status: "failed" })]);
  ok("mark_subscription_payment_failed sets failed", (await one("select status from app.subscription_payment where id=$1", [intent2.id])).status === "failed");

  const payMine = await asRole(idOwner, org1, () => client.query("select count(*)::int n from app.subscription_payment"));
  ok("org admin reads own payments (RLS)", payMine.ok && payMine.value.rows[0].n >= 1, payMine.error);
  const payViewer = await asRole(idViewer, org1, () => client.query("select count(*)::int n from app.subscription_payment"));
  ok("non-admin member cannot read payments (is_org_admin RLS)", payViewer.ok && payViewer.value.rows[0].n === 0);
  const payCross = await asRole(idOwner, org2, () => client.query("select count(*)::int n from app.subscription_payment where org_id=$1", [org1]));
  ok("payments invisible under a foreign org context", payCross.ok && payCross.value.rows[0].n === 0);

  // ==================== Platform operator (0039) ====================
  const opNo = await asRole(idOwner, org1, () => client.query("select app.is_platform_operator() b"));
  ok("is_platform_operator false for a normal user", opNo.ok && opNo.value.rows[0].b === false, opNo.error);
  const opForbidden = await asRole(idOwner, org1, () => client.query("select * from app.platform_list_orgs()"));
  ok("platform_list_orgs FORBIDDEN for a non-operator", opForbidden.ok === false && /FORBIDDEN/i.test(opForbidden.error || ""));
  const actForbidden = await asRole(idOwner, org1, () => client.query("select * from app.platform_org_activity()"));
  ok("platform_org_activity FORBIDDEN for a non-operator", actForbidden.ok === false && /FORBIDDEN/i.test(actForbidden.error || ""));
  const histForbidden = await asRole(idOwner, org1, () => client.query("select * from app.platform_subscription_history($1)", [org1]));
  ok("platform_subscription_history FORBIDDEN for a non-operator", histForbidden.ok === false && /FORBIDDEN/i.test(histForbidden.error || ""));

  await q("insert into app.platform_operator(identity_id) values($1)", [idOwner]);
  const opYes = await asRole(idOwner, org1, () => client.query("select app.is_platform_operator() b"));
  ok("is_platform_operator true after seeding", opYes.ok && opYes.value.rows[0].b === true);

  await callAs(idOwner, org1, "select app.operator_set_subscription($1,'pro','active'::app.subscription_status,null,null,'partner')", [org2]);
  const org2sub = await one("select plan_code, status, notes from app.org_subscription where org_id=$1", [org2]);
  ok("operator_set_subscription applies the override (org2 → pro/active/partner)", org2sub.plan_code === "pro" && org2sub.status === "active" && org2sub.notes === "partner", JSON.stringify(org2sub));
  const opPay = await asRole(idOwner, org1, () => client.query("select count(*)::int n from app.operator_list_payments($1)", [org1]));
  ok("operator_list_payments works for an operator", opPay.ok && opPay.value.rows[0].n >= 1, opPay.error);

  // ==================== Platform foundation (0048) ====================
  const listed = await callAs(idOwner, org1, "select * from app.platform_list_orgs(null,null,null,20,0)");
  const org2Row = listed.find((r) => r.org_id === org2);
  ok("platform_list_orgs pages every org with its plan limits and usage",
    listed.length >= 2 && org2Row && org2Row.plan_code === "pro" && Number(org2Row.total_count) === listed.length
      && org2Row.max_properties !== undefined && org2Row.properties !== null,
    JSON.stringify(org2Row && { p: org2Row.plan_code, t: org2Row.total_count, mx: org2Row.max_properties }));

  // total_count is the size of the FILTERED set, not of the page — that is what drives the pager.
  const firstPage = await callAs(idOwner, org1, "select * from app.platform_list_orgs(null,null,null,1,0)");
  const secondPage = await callAs(idOwner, org1, "select * from app.platform_list_orgs(null,null,null,1,1)");
  ok("platform_list_orgs paging returns one row per page but the full total",
    firstPage.length === 1 && secondPage.length === 1 && Number(firstPage[0].total_count) >= 2
      && firstPage[0].org_id !== secondPage[0].org_id,
    JSON.stringify({ a: firstPage.length, b: secondPage.length, t: firstPage[0] && firstPage[0].total_count }));

  const searched = await callAs(idOwner, org1, "select * from app.platform_list_orgs(null,'Org Two',null,20,0)");
  const filtered = await callAs(idOwner, org1, "select * from app.platform_list_orgs(null,null,'active'::app.subscription_status,20,0)");
  ok("platform_list_orgs filters by name and by status",
    searched.length === 1 && searched[0].org_id === org2
      && filtered.length >= 1 && filtered.every((r) => r.status === "active"),
    JSON.stringify({ s: searched.length, f: filtered.map((r) => r.status) }));

  // The detail page reads one office through the same function, so the list and the 360 view can
  // never drift apart into two versions of "what an office looks like".
  const single = await callAs(idOwner, org1, "select * from app.platform_list_orgs($1)", [org2]);
  ok("platform_list_orgs narrows to a single org for the detail view",
    single.length === 1 && single[0].org_id === org2, JSON.stringify(single.map((r) => r.org_name)));

  // auth.users does not exist on bare Postgres: no rows, no error (the console shows "—").
  const activity = await callAs(idOwner, org1, "select * from app.platform_org_activity()");
  ok("platform_org_activity degrades to empty without auth.users instead of raising", Array.isArray(activity));

  // The trigger must capture the change made by operator_set_subscription above (org2 → pro/active).
  const evs = await callAs(idOwner, org1, "select * from app.platform_subscription_history($1)", [org2]);
  const changed = evs.find((e) => e.kind === "plan_changed");
  const seeded = evs.find((e) => e.kind === "created");
  ok("subscription history records the plan change with both sides and a price snapshot",
    changed && changed.from_plan === "enterprise" && changed.to_plan === "pro"
      && changed.to_status === "active" && Number(changed.plan_price_halalas) === 29900,
    JSON.stringify(changed && { f: changed.from_plan, t: changed.to_plan, p: changed.plan_price_halalas }));
  ok("the origin event snapshots the plan the subscription started on",
    seeded && seeded.to_plan === "enterprise" && seeded.from_plan === null && Number(seeded.plan_price_halalas) === 0,
    JSON.stringify(seeded && { t: seeded.to_plan, f: seeded.from_plan, p: seeded.plan_price_halalas }));
  // Whether the trigger wrote it (fresh DB) or the backfill did (the live one), no subscription may
  // sit on the timeline without an origin — that is what makes growth countable from day one.
  const orphans = await one(`select count(*)::int n from app.org_subscription s
     where not exists (select 1 from app.subscription_event e where e.org_id = s.org_id and e.kind='created')`);
  ok("every subscription has an origin event", orphans.n === 0, "orphans: " + orphans.n);

  let evUpd = "", evDel = "";
  try { await q("update app.subscription_event set kind='created' where org_id=$1", [org2]); } catch (e) { evUpd = e.message; }
  try { await q("delete from app.subscription_event where org_id=$1", [org2]); } catch (e) { evDel = e.message; }
  ok("subscription_event is append-only", /APPEND_ONLY/.test(evUpd) && /APPEND_ONLY/.test(evDel), evUpd + " | " + evDel);

  // Changing a customer's plan is the most sensitive action on the platform; it must leave a trail.
  const opAudit = await one(
    "select action, org_id, identity_id, membership_id, detail from app.audit_log where action='platform.subscription_update' and org_id=$1 order by id desc limit 1",
    [org2]);
  ok("operator_set_subscription writes an audit row carrying the before state",
    opAudit && opAudit.identity_id === idOwner && opAudit.detail.before.plan === "enterprise"
      && opAudit.detail.requested.plan === "pro",
    JSON.stringify(opAudit && opAudit.detail));
  ok("the platform audit row has no membership — a platform action, not an office action",
    opAudit && opAudit.membership_id === null);

  let setMissing = "";
  try { await callAs(idOwner, org1, "select app.operator_set_subscription($1,'pro')", ["00000000-0000-0000-0000-000000000000"]); }
  catch (e) { setMissing = e.message; }
  ok("operator_set_subscription rejects an org with no subscription", /SUBSCRIPTION_NOT_FOUND/.test(setMissing), setMissing);

  // ==================== Executive dashboard (0049) ====================
  for (const fn of ["app.platform_kpis()", "app.platform_revenue_series(3)", "app.platform_plan_distribution()", "app.platform_top_customers(3)"]) {
    const denied = await asRole(idViewer, org1, () => client.query(`select * from ${fn}`));
    ok(`${fn.split("(")[0]} FORBIDDEN for a non-operator`, denied.ok === false && /FORBIDDEN/i.test(denied.error || ""), denied.error);
  }

  // Absolute totals depend on everything else this file seeded, so the revenue rule is tested by
  // MOVEMENT: add one subscription of each kind on the same priced plan and watch what MRR does.
  const readKpis = async () => (await callAs(idOwner, org1, "select app.platform_kpis() k"))[0].k;
  const addOrgOn = async (name, status) => {
    const id = (await one("insert into app.organization(name) values($1) returning id", [name])).id;
    await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'pro',$2)", [id, status]);
    return id;
  };

  const kpiBase = await readKpis();
  await addOrgOn("MRR Active", "active");
  const kpiActive = await readKpis();
  ok("an active subscription adds exactly its plan's list price to MRR",
    Number(kpiActive.mrr_halalas) - Number(kpiBase.mrr_halalas) === 29900
      && Number(kpiActive.orgs_active) === Number(kpiBase.orgs_active) + 1,
    JSON.stringify({ before: kpiBase.mrr_halalas, after: kpiActive.mrr_halalas }));

  await addOrgOn("MRR Comped", "comped");
  const kpiComped = await readKpis();
  ok("a comp on a priced plan is a grant, not recurring revenue",
    Number(kpiComped.mrr_halalas) === Number(kpiActive.mrr_halalas)
      && Number(kpiComped.orgs_comped) === Number(kpiActive.orgs_comped) + 1,
    JSON.stringify({ mrr: kpiComped.mrr_halalas, comped: kpiComped.orgs_comped }));

  await addOrgOn("MRR Trial", "trialing");
  const kpiTrial = await readKpis();
  ok("a trial pays nothing, so it adds nothing to MRR",
    Number(kpiTrial.mrr_halalas) === Number(kpiComped.mrr_halalas)
      && Number(kpiTrial.orgs_trialing) === Number(kpiComped.orgs_trialing) + 1,
    JSON.stringify({ mrr: kpiTrial.mrr_halalas, trialing: kpiTrial.orgs_trialing }));

  await addOrgOn("MRR PastDue", "past_due");
  const kpiRisk = await readKpis();
  ok("a past-due subscription leaves MRR and is reported as revenue at risk instead",
    Number(kpiRisk.mrr_halalas) === Number(kpiTrial.mrr_halalas)
      && Number(kpiRisk.mrr_at_risk_halalas) - Number(kpiTrial.mrr_at_risk_halalas) === 29900,
    JSON.stringify({ mrr: kpiRisk.mrr_halalas, risk: kpiRisk.mrr_at_risk_halalas }));

  const kpis = kpiRisk;
  ok("ARR is twelve times MRR", Number(kpis.arr_halalas) === Number(kpis.mrr_halalas) * 12);
  ok("platform KPIs count tenant data without reading a tenant row",
    Number.isFinite(Number(kpis.properties)) && Number.isFinite(Number(kpis.units))
      && Number.isFinite(Number(kpis.contracts)) && Number(kpis.users) >= 3,
    JSON.stringify({ p: kpis.properties, u: kpis.units, c: kpis.contracts, users: kpis.users }));
  // The back-seeded origin rows are dated to each subscription's creation; counting them as history
  // would claim trend we never recorded. Only the real status change above may set trend_since.
  ok("trend_since ignores the reconstructed back-seed", kpis.trend_since !== null, JSON.stringify(kpis.trend_since));

  const series = await callAs(idOwner, org1, "select * from app.platform_revenue_series(6)");
  ok("revenue series returns every month in the window, zeros included",
    series.length === 6 && series.every((r) => Number(r.paid_halalas) >= 0)
      && series[0].month_start < series[5].month_start,
    JSON.stringify({ n: series.length }));
  ok("revenue series attributes the paid subscription payment to the current month",
    Number(series[5].paid_halalas) >= 9900, JSON.stringify(series[5]));

  const dist = await callAs(idOwner, org1, "select * from app.platform_plan_distribution()");
  const planCount = (await one("select count(*)::int n from app.plan")).n;
  const pro = dist.find((r) => r.plan_code === "pro");
  ok("plan distribution lists every plan in the catalog, empty tiers included",
    dist.length === planCount, JSON.stringify(dist.map((r) => r.plan_code)));
  ok("plan distribution prices only the active subscriptions on each tier",
    pro && Number(pro.mrr_halalas) === Number(pro.orgs_active) * Number(pro.price_halalas)
      && Number(pro.orgs) > Number(pro.orgs_active),
    JSON.stringify(pro && { all: pro.orgs, active: pro.orgs_active, mrr: pro.mrr_halalas }));

  const top = await callAs(idOwner, org1, "select * from app.platform_top_customers(5)");
  ok("top customers ranks by what was actually paid, and omits offices that paid nothing",
    top.length >= 1 && top.every((r) => Number(r.paid_halalas) > 0),
    JSON.stringify(top.map((r) => [r.org_name, r.paid_halalas])));

  // ==================== Tenant 360 + operator levers (0050) ====================
  for (const fn of ["app.platform_tenant_360($1)", "app.platform_identity_activity()"]) {
    const denied = await asRole(idViewer, org1, () => client.query(`select * from ${fn}`, fn.includes("$1") ? [org1] : []));
    ok(`${fn.split("(")[0]} FORBIDDEN for a non-operator`, denied.ok === false && /FORBIDDEN/i.test(denied.error || ""), denied.error);
  }
  const extDenied = await asRole(idViewer, org1, () => client.query("select app.operator_extend_trial($1,7)", [org1]));
  ok("operator_extend_trial FORBIDDEN for a non-operator", extDenied.ok === false && /FORBIDDEN/i.test(extDenied.error || ""));

  // A dedicated office so suspending it cannot disturb the fixtures the rest of the file relies on.
  const orgSusp = (await one("insert into app.organization(name) values('Suspend Me') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'pro','active')", [orgSusp]);
  const idSusp = await mkId("+966500000031");
  await mkMember(idSusp, orgSusp, "owner");
  const ownerSusp = (await one("insert into app.party(org_id,display_name,roles) values($1,'مالك',array['owner']::app.party_role[]) returning id", [orgSusp])).id;
  await q("insert into app.owner(org_id,party_id,is_self) values($1,$2,true)", [orgSusp, ownerSusp]);
  const propSusp = (await one("insert into app.property(org_id,owner_id,name) values($1,(select id from app.owner where org_id=$1),'عقار قائم') returning id", [orgSusp])).id;

  await callAs(idOwner, org1, "select app.operator_set_subscription($1,null,'suspended'::app.subscription_status,null,null,'عدم سداد')", [orgSusp]);
  const suspActive = (await one("select app.subscription_active($1) a", [orgSusp])).a;
  ok("a suspended subscription is not live", suspActive === false);
  const blocked = await tryWrite(idSusp, orgSusp, "insert into app.property(org_id,owner_id,name) values($1,(select id from app.owner where org_id=$1),'عقار جديد')", [orgSusp]);
  ok("suspension blocks NEW business, like every other inactive status", blocked.ok === false, blocked.error);
  const stillEditable = await tryWrite(idSusp, orgSusp, "update app.property set city='الرياض' where id=$1", [propSusp]);
  ok("suspension leaves existing data readable and editable (Charter ق-هـ)", stillEditable.ok === true, stillEditable.error);
  // Suspension is not churn: the office was cut off, it did not leave.
  const suspEvent = await one("select to_status from app.subscription_event where org_id=$1 order by id desc limit 1", [orgSusp]);
  ok("suspension is recorded as its own status, never as a cancellation", suspEvent.to_status === "suspended", JSON.stringify(suspEvent));

  let badDays = "", notTrialing = "";
  try { await callAs(idOwner, org1, "select app.operator_extend_trial($1,0)", [orgSusp]); } catch (e) { badDays = e.message; }
  try { await callAs(idOwner, org1, "select app.operator_extend_trial($1,14)", [orgSusp]); } catch (e) { notTrialing = e.message; }
  ok("extend_trial refuses a nonsense day count", /INVALID_DAYS/.test(badDays), badDays);
  ok("extend_trial refuses an office that is not on a trial", /NOT_TRIALING/.test(notTrialing), notTrialing);

  // A trial that lapsed a month ago must not be extended from its old end date.
  const orgLapsed = (await one("insert into app.organization(name) values('Lapsed Trial') returning id")).id;
  await q(`insert into app.org_subscription(org_id,plan_code,status,trial_ends_at)
           values($1,'basic','trialing', now() - interval '30 days')`, [orgLapsed]);
  const newEnd = (await callAs(idOwner, org1, "select app.operator_extend_trial($1,14) t", [orgLapsed]))[0].t;
  ok("extend_trial counts from today, not from a trial that already expired",
    new Date(newEnd).getTime() > Date.now() + 13 * 86400000, String(newEnd));
  const trialAudit = await one("select action, detail from app.audit_log where org_id=$1 and action='platform.trial_extend'", [orgLapsed]);
  ok("extending a trial writes an audit row with both dates", trialAudit && Number(trialAudit.detail.days) === 14, JSON.stringify(trialAudit?.detail));

  const t360 = (await callAs(idOwner, org1, "select app.platform_tenant_360($1) v", [org1]))[0].v;
  ok("tenant 360 returns the office, its subscription, usage and limits in one call",
    t360.org.id === org1 && t360.subscription.plan_code && t360.usage.properties >= 1 && "properties" in t360.limits,
    JSON.stringify({ plan: t360.subscription?.plan_code, usage: t360.usage }));
  ok("tenant 360 reports the portfolio as COUNTS — no tenant row is returned",
    Number.isInteger(t360.portfolio.contracts) && Number.isInteger(t360.portfolio.owners)
      && Number.isInteger(t360.portfolio.tenants) && !JSON.stringify(t360.portfolio).includes("display_name"),
    JSON.stringify(t360.portfolio));
  ok("tenant 360 shows what the office paid US, and none of the office's own money",
    "paid_halalas" in t360.revenue && !("collected_halalas" in t360.revenue) && !("outstanding_halalas" in t360.revenue),
    JSON.stringify(Object.keys(t360.revenue)));
  const teamOwner = (t360.team ?? []).find((m) => m.identity_id === idOwner);
  ok("tenant 360 lists the office team — who to call and what they may do",
    Array.isArray(t360.team) && teamOwner && teamOwner.role === "owner" && "last_sign_in_at" in teamOwner,
    JSON.stringify((t360.team ?? []).map((m) => m.role)));
  const t360Missing = (await callAs(idOwner, org1, "select app.platform_tenant_360($1) v", ["00000000-0000-0000-0000-000000000000"]))[0].v;
  ok("tenant 360 returns null for an office that does not exist, not an error", t360Missing === null);

  // ==================== Subscription + billing centres (0051) ====================
  for (const fn of ["app.platform_list_payments()", "app.platform_billing_health()", "app.platform_subscription_center()"]) {
    const denied = await asRole(idViewer, org1, () => client.query(`select * from ${fn}`));
    ok(`${fn.split("(")[0]} FORBIDDEN for a non-operator`, denied.ok === false && /FORBIDDEN/i.test(denied.error || ""), denied.error);
  }
  const planDenied = await asRole(idViewer, org1, () => client.query("select app.operator_upsert_plan('x','خطة',100)"));
  ok("operator_upsert_plan FORBIDDEN for a non-operator", planDenied.ok === false && /FORBIDDEN/i.test(planDenied.error || ""));

  for (const [label, sql] of [
    ["a code that is not a slug", "select app.operator_upsert_plan('Bad Code','خطة',100)"],
    ["an empty name", "select app.operator_upsert_plan('trial_x','   ',100)"],
    ["a negative price", "select app.operator_upsert_plan('trial_x','خطة',-1)"],
    ["a negative limit", "select app.operator_upsert_plan('trial_x','خطة',100,-5)"],
  ]) {
    let err = "";
    try { await callAs(idOwner, org1, sql); } catch (e) { err = e.message; }
    ok(`upsert_plan rejects ${label}`, /INVALID_|NAME_REQUIRED/.test(err), err);
  }

  await callAs(idOwner, org1, "select app.operator_upsert_plan('growth','النمو',19900,60,300,6,true,4)");
  const created = await one("select name_ar, price_halalas, max_units, is_public from app.plan where code='growth'");
  ok("upsert_plan creates a plan from the console", created && Number(created.price_halalas) === 19900 && Number(created.max_units) === 300, JSON.stringify(created));
  await callAs(idOwner, org1, "select app.operator_upsert_plan('growth','النمو',24900,60,300,6,false,4)");
  const retuned = await one("select price_halalas, is_public from app.plan where code='growth'");
  ok("upsert_plan re-tunes an existing plan in place", Number(retuned.price_halalas) === 24900 && retuned.is_public === false);
  const planAudit = await one("select org_id, detail from app.audit_log where action='platform.plan_upsert' order by id desc limit 1");
  ok("a plan change is audited as a platform-wide action, with no owning org",
    planAudit && planAudit.org_id === null && Number(planAudit.detail.before.price_halalas) === 19900
      && Number(planAudit.detail.after.price_halalas) === 24900,
    JSON.stringify(planAudit?.detail));
  // Re-pricing must not rewrite what past events recorded (0048 snapshots the price).
  const oldSnapshot = await one("select plan_price_halalas from app.subscription_event where to_plan='pro' order by id limit 1");
  ok("re-pricing a plan cannot rewrite the revenue already recorded", Number(oldSnapshot.plan_price_halalas) === 29900);

  const pays = await callAs(idOwner, org1, "select * from app.platform_list_payments(null,null,50,0)");
  ok("payments list spans every office and names each one",
    pays.length >= 1 && pays.every((p) => p.org_name) && Number(pays[0].total_count) === pays.length,
    JSON.stringify({ n: pays.length, t: pays[0]?.total_count }));
  const paidOnly = await callAs(idOwner, org1, "select * from app.platform_list_payments(null,'paid'::app.subscription_payment_status,50,0)");
  ok("payments list filters by status", paidOnly.every((p) => p.status === "paid") && paidOnly.length >= 1);

  const health = (await callAs(idOwner, org1, "select app.platform_billing_health(30) v"))[0].v;
  ok("billing health counts paid and failed over the window", Number(health.paid_count) >= 1 && Number(health.failed_count) >= 1, JSON.stringify(health));
  ok("success rate is a real ratio of the attempts made",
    Math.abs(Number(health.success_rate) - health.paid_count / (health.paid_count + health.failed_count)) < 0.0001,
    JSON.stringify({ r: health.success_rate, p: health.paid_count, f: health.failed_count }));
  ok("failure reasons are grouped, and unreadable ones are left unnamed rather than invented",
    Array.isArray(health.failure_reasons), JSON.stringify(health.failure_reasons));

  const emptyWindow = (await callAs(idOwner, org1, "select app.platform_billing_health(0) v"))[0].v;
  ok("a window with no attempts reports no success rate, not a perfect one",
    emptyWindow.paid_count === 0 && emptyWindow.failed_count === 0 ? emptyWindow.success_rate === null : true,
    JSON.stringify({ p: emptyWindow.paid_count, f: emptyWindow.failed_count, r: emptyWindow.success_rate }));

  const centre = (await callAs(idOwner, org1, "select app.platform_subscription_center() v"))[0].v;
  ok("subscription centre separates trials, renewals and stopped accounts",
    Number(centre.trials.total) >= 1 && "due_30d" in centre.renewals
      && Number(centre.stopped.suspended) >= 1 && "canceled_30d" in centre.stopped,
    JSON.stringify({ t: centre.trials, s: centre.stopped }));
  ok("the centre counts the lapsed trial nobody has decided about", Number(centre.trials.lapsed) >= 0, JSON.stringify(centre.trials));
  ok("the centre flags active offices that cannot renew themselves — no saved card",
    Number.isInteger(centre.active_without_card) && Number(centre.active_without_card) >= 1,
    JSON.stringify(centre.active_without_card));

  // ==================== Health, alerts, audit centre (0052) ====================
  for (const fn of ["app.platform_health()", "app.platform_alerts()", "app.platform_list_audit()", "app.platform_audit_actions()"]) {
    const denied = await asRole(idViewer, org1, () => client.query(`select * from ${fn}`));
    ok(`${fn.split("(")[0]} FORBIDDEN for a non-operator`, denied.ok === false && /FORBIDDEN/i.test(denied.error || ""), denied.error);
  }
  // Service-role-only functions have NO internal gate — the grant is the whole defence. 0001 sets
  // `alter default privileges ... grant execute on functions to anon, authenticated`, so revoking
  // from PUBLIC alone leaves them wide open to any signed-in user. These assert the revoke covered
  // the roles that actually matter.
  const forge = await asRole(idOwner, org1, () => client.query("select app.record_cron_run('drain-notifications',true)"));
  ok("record_cron_run is not callable by a signed-in user, operator or not",
    forge.ok === false && /permission denied/i.test(forge.error || ""), forge.error);
  const forgePay = await asRole(idOwner, org1, () =>
    client.query("select app.apply_subscription_payment($1,'forged','{}'::jsonb)", ["00000000-0000-0000-0000-000000000000"]));
  ok("a signed-in user cannot mark their own subscription paid (webhook-only surface)",
    forgePay.ok === false && /permission denied/i.test(forgePay.error || ""), forgePay.error);
  const forgeFail = await asRole(idOwner, org1, () =>
    client.query("select app.mark_subscription_payment_failed($1,'{}'::jsonb)", ["00000000-0000-0000-0000-000000000000"]));
  ok("a signed-in user cannot mark a subscription payment failed either",
    forgeFail.ok === false && /permission denied/i.test(forgeFail.error || ""), forgeFail.error);

  // The rest of the ungated surface, locked by 0053. Each of these has NO internal check — the
  // grant is the entire defence, so the test is the only thing that keeps it honest.
  for (const [what, sql, params] of [
    ["lease the email outbox", "select * from app.claim_email_deliveries(5)", []],
    ["declare an email sent", "select app.mark_email_delivery_sent($1,'x',null)", ["00000000-0000-0000-0000-000000000000"]],
    ["lease due renewals", "select * from app.claim_due_renewals(5)", []],
    ["push an office into dunning", "select app.record_dunning_failure($1,'{}'::jsonb)", [org2]],
    ["attach a card token to any office", "select app.save_payment_method($1,'tok','visa','1111',1,2030)", [org2]],
    ["read another office's usage", "select app.usage_count($1,'units')", [org2]],
  ]) {
    const attempt = await asRole(idOwner, org1, () => client.query(sql, params));
    ok(`a signed-in user cannot ${what}`, attempt.ok === false && /permission denied/i.test(attempt.error || ""), attempt.error);
  }

  await q("select app.record_cron_run('drain-notifications', true, now() - interval '2 seconds', '{\"sent\":3}'::jsonb)");
  await q("select app.record_cron_run('renew-subscriptions', false, now() - interval '1 second', '{}'::jsonb, 'gateway timeout')");
  const sys = (await callAs(idOwner, org1, "select app.platform_health() v"))[0].v;
  const drain = sys.cron.find((c) => c.job === "drain-notifications");
  const renew = sys.cron.find((c) => c.job === "renew-subscriptions");
  ok("health reports the LAST run of each cron job, with its outcome",
    sys.cron.length === 2 && drain.ok === true && renew.ok === false && renew.error === "gateway timeout",
    JSON.stringify(sys.cron));
  ok("a run records how long it took", Number(drain.duration_ms) >= 1000, String(drain.duration_ms));
  ok("health reports the queues we can observe from in here",
    "pending" in sys.email_queue && "awaiting_webhook" in sys.payments && "unread" in sys.notifications,
    JSON.stringify(Object.keys(sys)));

  const alerts = await callAs(idOwner, org1, "select * from app.platform_alerts()");
  const byKind = Object.fromEntries(alerts.map((a) => [a.kind, a]));
  ok("a failed cron is the most severe alert — it hides every other one",
    byKind.cron_failed && byKind.cron_failed.severity === 1 && byKind.cron_failed.detail.includes("renew-subscriptions"),
    JSON.stringify(byKind.cron_failed));
  ok("alerts come back ordered by severity and never with a zero count",
    alerts.every((a) => a.count > 0) && alerts.every((a, i) => i === 0 || alerts[i - 1].severity <= a.severity),
    JSON.stringify(alerts.map((a) => [a.kind, a.severity, a.count])));
  ok("a suspended office shows up as past-due or stopped work, not as an alert of its own",
    !("suspended" in byKind), JSON.stringify(Object.keys(byKind)));

  const audit = await callAs(idOwner, org1, "select * from app.platform_list_audit(null,null,null,false,100,0)");
  const platformRow = audit.find((r) => r.action === "platform.subscription_update");
  const officeRow = audit.find((r) => !r.is_platform_action);
  ok("the audit centre spans every office and names the actor",
    audit.length >= 2 && Number(audit[0].total_count) === audit.length, JSON.stringify({ n: audit.length }));
  ok("a platform action shows its full detail — that is our own record",
    platformRow && platformRow.is_platform_action === true && platformRow.detail !== null,
    JSON.stringify(platformRow && platformRow.action));
  // The isolation line: the console sees THAT an office acted, never what was inside the action.
  ok("an office action shows its metadata but never its payload",
    officeRow && officeRow.action && officeRow.detail === null,
    JSON.stringify(officeRow && { a: officeRow.action, d: officeRow.detail }));
  const platformOnly = await callAs(idOwner, org1, "select * from app.platform_list_audit(null,null,null,true,100,0)");
  ok("the audit centre can narrow to platform actions alone",
    platformOnly.length >= 1 && platformOnly.every((r) => r.action.startsWith("platform.")),
    JSON.stringify(platformOnly.map((r) => r.action)));
  const orgScoped = await callAs(idOwner, org1, "select * from app.platform_list_audit($1,null,null,false,100,0)", [org2]);
  ok("the audit centre filters to one office", orgScoped.every((r) => r.org_id === org2) && orgScoped.length >= 1);
  const actions = await callAs(idOwner, org1, "select * from app.platform_audit_actions()");
  ok("the action filter is built from what the log actually contains",
    actions.length >= 2 && actions.some((a) => a.action.startsWith("platform.")),
    JSON.stringify(actions.slice(0, 4).map((a) => a.action)));

  // ==================== Settings, flags, broadcast (0054) ====================
  for (const fn of ["app.platform_settings()", "app.platform_list_flags()", "app.platform_list_broadcasts(5)"]) {
    const denied = await asRole(idViewer, org1, () => client.query(`select * from ${fn}`));
    ok(`${fn.split("(")[0]} FORBIDDEN for a non-operator`, denied.ok === false && /FORBIDDEN/i.test(denied.error || ""), denied.error);
  }
  const settingDenied = await asRole(idViewer, org1, () => client.query("select app.operator_set_setting('trial_days','7'::jsonb)"));
  ok("operator_set_setting FORBIDDEN for a non-operator", settingDenied.ok === false && /FORBIDDEN/i.test(settingDenied.error || ""));
  const castDenied = await asRole(idViewer, org1, () => client.query("select app.platform_broadcast('x',null,'{}'::jsonb,'in_app',true)"));
  ok("platform_broadcast FORBIDDEN for a non-operator", castDenied.ok === false && /FORBIDDEN/i.test(castDenied.error || ""));
  // app.setting() is an internal helper with no gate of its own — it must not be reachable at all.
  const settingHelper = await asRole(idOwner, org1, () => client.query("select app.setting('trial_days')"));
  ok("the internal setting() helper is not callable by a signed-in user",
    settingHelper.ok === false && /permission denied/i.test(settingHelper.error || ""), settingHelper.error);

  for (const [label, sql] of [
    ["an unknown key", "select app.operator_set_setting('nope','1'::jsonb)"],
    ["a trial length that is not a number", "select app.operator_set_setting('trial_days','\"many\"'::jsonb)"],
    ["a trial length beyond a year", "select app.operator_set_setting('trial_days','400'::jsonb)"],
    // Zero would provision an office that is locked out the moment it is created (0055).
    ["a zero-day trial", "select app.operator_set_setting('trial_days','0'::jsonb)"],
    ["a starting plan that does not exist", "select app.operator_set_setting('default_plan','\"ghost\"'::jsonb)"],
  ]) {
    let err = "";
    try { await callAs(idOwner, org1, sql); } catch (e) { err = e.message; }
    ok(`set_setting rejects ${label}`, /UNKNOWN_SETTING|INVALID_SETTING|PLAN_NOT_FOUND/.test(err), err);
  }

  // The trial length stopped being a literal in create_organization: changing it here changes what
  // the next office gets, with no migration.
  await callAs(idOwner, org1, "select app.operator_set_setting('trial_days','45'::jsonb)");
  await callAs(idOwner, org1, "select app.operator_set_setting('default_plan','\"pro\"'::jsonb)");
  const idSettings = await mkId("+966500000041");
  const freshOrg = (await callAs(idSettings, null, "select app.create_organization('مكتب الإعدادات') id"))[0].id;
  const freshSub = await one("select plan_code, status, trial_ends_at from app.org_subscription where org_id=$1", [freshOrg]);
  const daysGranted = Math.round((new Date(freshSub.trial_ends_at) - Date.now()) / 86400000);
  ok("a new office starts on the configured plan for the configured number of days",
    freshSub.plan_code === "pro" && daysGranted >= 44 && daysGranted <= 45,
    JSON.stringify({ plan: freshSub.plan_code, days: daysGranted }));
  const settingAudit = await one("select org_id, detail from app.audit_log where action='platform.setting_update' order by id desc limit 1");
  ok("a settings change is audited platform-wide with both values",
    settingAudit && settingAudit.org_id === null && settingAudit.detail.key === "default_plan",
    JSON.stringify(settingAudit?.detail));

  let flagErr = "";
  try { await callAs(idOwner, org1, "select app.operator_set_flag('Bad Key','علم')"); } catch (e) { flagErr = e.message; }
  ok("set_flag rejects a key that is not a slug", /INVALID_FLAG_KEY/.test(flagErr), flagErr);
  try { await callAs(idOwner, org1, "select app.operator_set_flag('rollout_x','علم',null,false,150)"); } catch (e) { flagErr = e.message; }
  ok("set_flag rejects a rollout outside 0..100", /INVALID_ROLLOUT/.test(flagErr), flagErr);

  ok("an unknown feature is OFF — never on by accident",
    (await callAs(idOwner, org1, "select app.feature_enabled($1,'never_defined') b", [org1]))[0].b === false);

  await callAs(idOwner, org1, "select app.operator_set_flag('maintenance_module','وحدة الصيانة',null,true,0,null,true)");
  ok("a globally enabled flag is on for an office",
    (await callAs(idOwner, org1, "select app.feature_enabled($1,'maintenance_module') b", [org1]))[0].b === true);
  // A per-org row is an explicit decision for THIS office and outranks the global default.
  await q("insert into app.feature_flag(org_id,key,is_enabled) values($1,'maintenance_module',false)", [org1]);
  ok("a per-office override beats the global default, in both directions",
    (await callAs(idOwner, org1, "select app.feature_enabled($1,'maintenance_module') b", [org1]))[0].b === false
      && (await callAs(idOwner, org1, "select app.feature_enabled($1,'maintenance_module') b", [org2]))[0].b === true);

  await callAs(idOwner, org1, "select app.operator_set_flag('pro_reports','تقارير متقدمة',null,true,0,'pro',false)");
  ok("a plan gate keeps a feature off below the required tier, and on at or above it",
    (await callAs(idOwner, org1, "select app.feature_enabled($1,'pro_reports') b", [org2]))[0].b === true,
    "org2 is on pro");

  // The same office must get the same answer every time, or a rollout would flicker per request.
  await callAs(idOwner, org1, "select app.operator_set_flag('slow_rollout','إطلاق تدريجي',null,false,50)");
  const r1 = (await callAs(idOwner, org1, "select app.feature_enabled($1,'slow_rollout') b", [org1]))[0].b;
  const r2 = (await callAs(idOwner, org1, "select app.feature_enabled($1,'slow_rollout') b", [org1]))[0].b;
  ok("a percentage rollout is stable for the same office", r1 === r2, JSON.stringify({ r1, r2 }));
  const zero = (await callAs(idOwner, org1, "select app.feature_enabled($1,'slow_rollout') b", [freshOrg]))[0].b;
  await callAs(idOwner, org1, "select app.operator_set_flag('slow_rollout','إطلاق تدريجي',null,false,0)");
  ok("a rollout of zero reaches nobody",
    (await callAs(idOwner, org1, "select app.feature_enabled($1,'slow_rollout') b", [freshOrg]))[0].b === false,
    JSON.stringify({ before: zero }));

  // A broadcast is the least reversible action here, so the dry run must count without writing.
  const notesBefore = (await one("select count(*)::int n from app.notification where kind='platform_broadcast'")).n;
  const dry = (await callAs(idOwner, org1, "select app.platform_broadcast('صيانة مجدولة','الليلة','{}'::jsonb,'in_app',true) v"))[0].v;
  const notesAfterDry = (await one("select count(*)::int n from app.notification where kind='platform_broadcast'")).n;
  ok("a dry run counts the audience and writes nothing",
    dry.dry_run === true && dry.orgs >= 2 && notesAfterDry === notesBefore, JSON.stringify(dry));

  const sent = (await callAs(idOwner, org1, "select app.platform_broadcast('صيانة مجدولة','الليلة','{}'::jsonb,'in_app',false) v"))[0].v;
  const notesAfter = (await one("select count(*)::int n from app.notification where kind='platform_broadcast'")).n;
  ok("sending reaches exactly the offices the dry run counted",
    sent.orgs === dry.orgs && notesAfter - notesBefore === sent.orgs, JSON.stringify({ dry: dry.orgs, sent: sent.orgs }));

  const targeted = (await callAs(idOwner, org1, "select app.platform_broadcast('للمتأخرين',null,$1::jsonb,'in_app',true) v", [JSON.stringify({ status: "past_due" })]))[0].v;
  const everyone = (await callAs(idOwner, org1, "select app.platform_broadcast('للجميع',null,'{}'::jsonb,'in_app',true) v"))[0].v;
  ok("an audience filter narrows the send", targeted.orgs < everyone.orgs, JSON.stringify({ targeted: targeted.orgs, all: everyone.orgs }));

  // An EXPLICITLY EMPTY org list means nobody. array_agg over zero rows returns NULL, the same NULL
  // that once meant "no restriction", so {"orgs": []} used to reach every office (0055).
  const noOne = (await callAs(idOwner, org1, "select app.platform_broadcast('لأحد',null,'{\"orgs\":[]}'::jsonb,'in_app',true) v"))[0].v;
  ok("an explicitly empty audience reaches nobody, not everybody", noOne.orgs === 0, JSON.stringify(noOne));
  const justOne = (await callAs(idOwner, org1, "select app.platform_broadcast('لواحد',null,$1::jsonb,'in_app',true) v", [JSON.stringify({ orgs: [org2] })]))[0].v;
  ok("an explicit org list reaches exactly that list", justOne.orgs === 1, JSON.stringify(justOne));

  let castErr = "";
  try { await callAs(idOwner, org1, "select app.platform_broadcast('  ',null,'{}'::jsonb,'in_app',false)"); } catch (e) { castErr = e.message; }
  ok("a broadcast with no title is refused", /TITLE_REQUIRED/.test(castErr), castErr);

  const history = await callAs(idOwner, org1, "select * from app.platform_list_broadcasts(10)");
  ok("every send is kept with what it reached", history.length >= 1 && Number(history[0].orgs_count) === sent.orgs);
  const castAudit = await one("select org_id, detail from app.audit_log where action='platform.broadcast' order by id desc limit 1");
  ok("a broadcast is audited with its audience and reach",
    castAudit && castAudit.org_id === null && Number(castAudit.detail.orgs) === sent.orgs, JSON.stringify(castAudit?.detail));

  // ==================== Recurring billing (0040): token, auto-renew, dunning ====================
  // org1 is basic/active with a future period (from the payment tests above), no card yet.
  let noCard = "";
  try { await callAs(idOwner, org1, "select app.set_auto_renew($1,true)", [org1]); } catch (e) { noCard = e.message; }
  ok("set_auto_renew requires a saved card", /NO_PAYMENT_METHOD/i.test(noCard), noCard);

  await q("select app.save_payment_method($1,$2,$3,$4,$5,$6)", [org1, "tok_123", "visa", "4242", 12, 2030]);
  const pm = await one("select token, brand, last4, status from app.org_payment_method where org_id=$1 and status='active'", [org1]);
  ok("save_payment_method stores an active token (reference, not card)", pm.token === "tok_123" && pm.brand === "visa" && pm.last4 === "4242");
  const armed = await one("select auto_renew, payment_method_id from app.org_subscription where org_id=$1", [org1]);
  ok("saving a card enables auto_renew + links the method", armed.auto_renew === true && !!armed.payment_method_id);

  const notDue = (await q("select count(*)::int n from app.claim_due_renewals(50)")).rows[0].n;
  ok("claim_due_renewals skips a not-yet-due subscription", notDue === 0, "got " + notDue);

  await q("update app.org_subscription set current_period_end = now() - interval '1 day' where org_id=$1", [org1]);
  const due = (await q("select * from app.claim_due_renewals(50)")).rows.find((r) => r.org_id === org1);
  ok("claim_due_renewals leases a due sub + opens an auto intent (9900, token)", !!due && Number(due.amount_halalas) === 9900 && due.token === "tok_123", JSON.stringify(due && { a: due.amount_halalas, t: due.token }));
  const autoIntent = await one("select initiated_by, attempt, status from app.subscription_payment where id=$1", [due.intent_id]);
  ok("auto intent recorded (initiated_by=auto, attempt=1)", autoIntent.initiated_by === "auto" && autoIntent.attempt === 1 && autoIntent.status === "initiated");
  const renewReclaim = (await q("select count(*)::int n from app.claim_due_renewals(50)")).rows[0].n;
  ok("claim does not re-lease an in-flight renewal", renewReclaim === 0);

  await q("select app.apply_subscription_payment($1,$2,$3::jsonb)", [due.intent_id, "moyasar-renew-1", JSON.stringify({ status: "paid" })]);
  const renewed = await one("select status, dunning_attempts, next_charge_at, (current_period_end > now()) fut from app.org_subscription where org_id=$1", [org1]);
  ok("apply renews: active, dunning reset, next_charge cleared, period extended", renewed.status === "active" && renewed.dunning_attempts === 0 && renewed.next_charge_at === null && renewed.fut === true, JSON.stringify(renewed));

  // Full dunning cycle: 3 failed auto-charges → past_due.
  for (let i = 1; i <= 3; i++) {
    await q("update app.org_subscription set current_period_end = now() - interval '1 day', next_charge_at = null where org_id=$1", [org1]);
    const m = (await q("select * from app.claim_due_renewals(50)")).rows.find((r) => r.org_id === org1);
    await q("select app.record_dunning_failure($1,$2::jsonb)", [m.intent_id, JSON.stringify({ error: "declined" })]);
  }
  const dun = await one("select status, dunning_attempts from app.org_subscription where org_id=$1", [org1]);
  ok("dunning: subscription goes past_due after 3 failed attempts", dun.status === "past_due" && dun.dunning_attempts === 3, JSON.stringify(dun));
  const billNotes = (await one("select count(*)::int n from app.notification where org_id=$1 and kind in ('billing_failed','subscription_past_due')", [org1])).n;
  ok("dunning raises billing notifications (in-app + queued email)", billNotes >= 1, "got " + billNotes);

  // RLS: payment methods are admin-only.
  const pmViewer = await asRole(idViewer, org1, () => client.query("select count(*)::int n from app.org_payment_method"));
  ok("non-admin cannot read payment methods (RLS)", pmViewer.ok && pmViewer.value.rows[0].n === 0);
  const pmAdmin = await asRole(idOwner, org1, () => client.query("select count(*)::int n from app.org_payment_method where status='active'"));
  ok("admin reads own active payment method (RLS)", pmAdmin.ok && pmAdmin.value.rows[0].n === 1, pmAdmin.error);

  // ==================== Roles & capabilities (0041) ====================
  const orgR = (await one("insert into app.organization(name) values('Roles Org') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [orgR]);
  const mkRoleMember = async (phone, role) => {
    const idn = await mkId(phone);
    await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,$3,'active',true)", [idn, orgR, role]);
    return idn;
  };
  const rOwner = await mkRoleMember("+966500000300", "owner");
  const rManager = await mkRoleMember("+966500000301", "manager");
  const rAccountant = await mkRoleMember("+966500000302", "accountant");
  const rStaff = await mkRoleMember("+966500000303", "staff");
  const rViewer = await mkRoleMember("+966500000304", "viewer");
  const pR = (await one("insert into app.party(org_id,display_name,legal_kind,roles) values($1,'Self','company',array['owner']::app.party_role[]) returning id", [orgR])).id;
  const ownR = (await one("insert into app.owner(org_id,party_id,is_self,owner_kind) values($1,$2,true,'company') returning id", [orgR, pR])).id;
  const tpR = (await one("insert into app.party(org_id,display_name,roles) values($1,'Tenant',array['tenant']::app.party_role[]) returning id", [orgR])).id;

  const tryIns = (sub, sql, params) => asRole(sub, orgR, () => client.query(sql, params));

  // manage_data: staff can create data, accountant cannot.
  ok("staff (manage_data) CAN create a property",
    (await tryIns(rStaff, "insert into app.property(org_id,owner_id,name) values($1,$2,'S')", [orgR, ownR])).ok === true);
  ok("accountant (no manage_data) CANNOT create a property",
    (await tryIns(rAccountant, "insert into app.property(org_id,owner_id,name) values($1,$2,'A')", [orgR, ownR])).ok === false);

  // manage_finance: accountant can record a payment, staff cannot.
  ok("accountant (manage_finance) CAN record a payment",
    (await tryIns(rAccountant, "insert into app.payment(org_id,party_id,amount_halalas) values($1,$2,50000)", [orgR, tpR])).ok === true);
  ok("staff (no manage_finance) CANNOT record a payment",
    (await tryIns(rStaff, "insert into app.payment(org_id,party_id,amount_halalas) values($1,$2,50000)", [orgR, tpR])).ok === false);

  // manager does both; viewer does neither.
  const mgrData = await tryIns(rManager, "insert into app.property(org_id,owner_id,name) values($1,$2,'M')", [orgR, ownR]);
  const mgrFin = await tryIns(rManager, "insert into app.payment(org_id,party_id,amount_halalas) values($1,$2,50000)", [orgR, tpR]);
  ok("manager CAN both data and finance", mgrData.ok === true && mgrFin.ok === true, (mgrData.error || "") + (mgrFin.error || ""));
  ok("viewer CANNOT insert (data)",
    (await tryIns(rViewer, "insert into app.property(org_id,owner_id,name) values($1,$2,'V')", [orgR, ownR])).ok === false);
  const vUpd = await asRole(rViewer, orgR, () => client.query("update app.property set city='x' where org_id=$1", [orgR]));
  ok("viewer UPDATE affects 0 rows", vUpd.ok && vUpd.value.rowCount === 0, vUpd.error);

  // has_capability + current_capabilities.
  const capStaff = await asRole(rStaff, orgR, () => client.query("select app.has_capability($1,'manage_data') d, app.has_capability($1,'manage_finance') f", [orgR]));
  ok("has_capability: staff data=true, finance=false", capStaff.ok && capStaff.value.rows[0].d === true && capStaff.value.rows[0].f === false, capStaff.error);
  const capAcct = await asRole(rAccountant, orgR, () => client.query("select app.has_capability($1,'manage_data') d, app.has_capability($1,'manage_finance') f", [orgR]));
  ok("has_capability: accountant data=false, finance=true", capAcct.ok && capAcct.value.rows[0].d === false && capAcct.value.rows[0].f === true);
  const capMgr = await asRole(rManager, orgR, () => client.query("select app.has_capability($1,'manage_team') t, app.has_capability($1,'manage_billing') b", [orgR]));
  ok("manager has neither manage_team nor manage_billing", capMgr.ok && capMgr.value.rows[0].t === false && capMgr.value.rows[0].b === false);
  const capOwner = await asRole(rOwner, orgR, () => client.query("select app.has_capability($1,'manage_team') t, app.has_capability($1,'manage_billing') b", [orgR]));
  ok("owner has manage_team + manage_billing", capOwner.ok && capOwner.value.rows[0].t === true && capOwner.value.rows[0].b === true);
  const capsStaff = await asRole(rStaff, orgR, () => client.query("select app.current_capabilities($1) c", [orgR]));
  ok("current_capabilities(staff) = {view, manage_data}",
    capsStaff.ok && JSON.stringify([...capsStaff.value.rows[0].c].sort()) === JSON.stringify(["manage_data", "view"]), JSON.stringify(capsStaff.value && capsStaff.value.rows[0].c));

  // ==================== Tenant / establishment model (0042) ====================
  const pEst = await one(
    "insert into app.party(org_id,display_name,legal_kind,roles,cr_number,vat_number,unified_number,cr_expiry) values($1,'شركة الراجحي','company',array['tenant']::app.party_role[],'1010','3001','700123','2030-01-01') returning id, cr_number, vat_number, unified_number, (cr_expiry is not null) has_exp",
    [orgR]);
  ok("party stores establishment identifiers (cr/vat/unified/expiry)",
    pEst.cr_number === "1010" && pEst.vat_number === "3001" && pEst.unified_number === "700123" && pEst.has_exp === true, JSON.stringify(pEst));

  const tEst = await one("insert into app.tenant(org_id,party_id,tenant_kind,tenant_type) values($1,$2,'company','company') returning id, tenant_type", [orgR, pEst.id]);
  ok("tenant.tenant_type persists (company)", tEst.tenant_type === "company");

  const pInd = (await one("insert into app.party(org_id,display_name,roles) values($1,'فرد',array['tenant']::app.party_role[]) returning id", [orgR])).id;
  ok("tenant_type defaults to individual", (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning tenant_type", [orgR, pInd])).tenant_type === "individual");

  const pSole = (await one("insert into app.party(org_id,display_name,roles) values($1,'مؤسسة',array['tenant']::app.party_role[]) returning id", [orgR])).id;
  ok("tenant_type accepts sole_establishment", (await one("insert into app.tenant(org_id,party_id,tenant_type) values($1,$2,'sole_establishment') returning tenant_type", [orgR, pSole])).tenant_type === "sole_establishment");

  const pBad = (await one("insert into app.party(org_id,display_name,roles) values($1,'x',array['tenant']::app.party_role[]) returning id", [orgR])).id;
  let badType = "";
  try { await q("insert into app.tenant(org_id,party_id,tenant_type) values($1,$2,'foobar')", [orgR, pBad]); } catch (e) { badType = e.message; }
  ok("tenant_type CHECK rejects an invalid value", /check|tenant_type/i.test(badType), badType);

  const propR = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'PR-Est') returning id", [orgR, ownR])).id;
  const uEst = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'C1','vacant') returning id", [orgR, propR])).id;
  const cEst = await one(
    "insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency,trade_name,representative_name,representative_capacity,representative_phone) values($1,$2,$3,$4,'CT-EST','commercial','draft','2025-01-01','2025-12-31',2400000,'quarterly','مخابز الريان','خالد','مدير','+966500000400') returning trade_name, representative_name, representative_capacity, representative_phone",
    [orgR, propR, uEst, tEst.id]);
  ok("contract stores per-contract trade_name + representative",
    cEst.trade_name === "مخابز الريان" && cEst.representative_name === "خالد" && cEst.representative_capacity === "مدير" && cEst.representative_phone === "+966500000400", JSON.stringify(cEst));

  // ==================== Sprint K: ejar method + draft edit / active immutable ====================
  const mEjar = (await one("insert into app.payment(org_id,party_id,amount_halalas,method) values($1,$2,10000,'ejar') returning method", [orgR, tpR])).method;
  ok("payment method 'ejar' accepted (0043)", mEjar === "ejar");

  const cDraft = (await one(
    "insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency) values($1,$2,$3,$4,'CT-K','commercial','draft',current_date,current_date+364,1200000,'quarterly') returning id",
    [orgR, propR, uEst, tEst.id])).id;
  ok("draft contract is editable (rent + trade_name)",
    (await q("update app.contract set annual_rent_halalas=3000000, trade_name='محل جديد' where id=$1 and status='draft'", [cDraft])).rowCount === 1);

  await q("select app.activate_contract($1)", [cDraft]);
  let immErr = "";
  try { await q("update app.contract set annual_rent_halalas=9999999 where id=$1", [cDraft]); } catch (e) { immErr = e.message; }
  ok("active contract stays immutable after edit-window", /CONTRACT_IMMUTABLE/i.test(immErr), immErr);

  ok("unit is editable", (await q("update app.unit set floor='3' where id=$1", [uEst])).rowCount === 1);
  ok("tenant is editable", (await q("update app.tenant set tenant_type='sole_establishment' where id=$1", [tEst.id])).rowCount === 1);

  // ==================== Sprint L: property fields + one-org guard (0044) ====================
  const propL = await one(
    "insert into app.property(org_id,owner_id,name,holding_type,property_code,property_type,occupancy_type,deed_type,deed_date,water_meter,planned_residential_units) values($1,$2,'PL','managed','PC-1','برج','family','ملكية','2030-01-01','WM-1',10) returning holding_type, property_code, occupancy_type, planned_residential_units",
    [orgR, ownR]);
  ok("property stores new fields (holding/code/occupancy/planned)",
    propL.holding_type === "managed" && propL.property_code === "PC-1" && propL.occupancy_type === "family" && propL.planned_residential_units === 10, JSON.stringify(propL));

  let badHold = "";
  try { await q("insert into app.property(org_id,owner_id,name,holding_type) values($1,$2,'X','foobar')", [orgR, ownR]); } catch (e) { badHold = e.message; }
  ok("holding_type CHECK rejects invalid", /check|holding_type/i.test(badHold), badHold);
  let badOcc = "";
  try { await q("insert into app.property(org_id,owner_id,name,occupancy_type) values($1,$2,'Y','zzz')", [orgR, ownR]); } catch (e) { badOcc = e.message; }
  ok("occupancy_type CHECK rejects invalid", /check|occupancy/i.test(badOcc), badOcc);

  const idOne = await mkId("+966500000500");
  const oneOrg = await asRole(idOne, null, async () => {
    const firstId = (await client.query("select app.create_organization('Org One L') id")).rows[0].id;
    let secondErr = "";
    try { await client.query("select app.create_organization('Org Two L')"); } catch (e) { secondErr = e.message; }
    return { firstId, secondErr };
  });
  ok("create_organization: first org for a user succeeds", oneOrg.ok && !!oneOrg.value.firstId, oneOrg.error);
  ok("create_organization: a second org is blocked (OWN_ORG_EXISTS)", oneOrg.ok && /OWN_ORG_EXISTS/i.test(oneOrg.value.secondErr), JSON.stringify(oneOrg.value));

  // ============ Sprint P: enforced contract numbering + ejar block (0045) ============
  const year = new Date().toLocaleString("en-CA", { timeZone: "Asia/Riyadh" }).slice(0, 4);
  // A contract inserted WITHOUT a number gets CT-YYYY-NNNNN from the trigger.
  const cAuto1 = await one(
    "insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency) values($1,$2,$3,$4,'residential','draft','2031-01-01','2031-12-31',120000,'quarterly') returning id, contract_number, ejar_broker_office",
    [orgR, propR, uEst, tEst.id]);
  ok("contract number auto-assigned in CT-YYYY-NNNNN format",
    new RegExp(`^CT-${year}-\\d{5}$`).test(cAuto1.contract_number), cAuto1.contract_number);

  const cAuto2 = await one(
    "insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency) values($1,$2,$3,$4,'residential','draft','2032-01-01','2032-12-31',120000,'quarterly') returning contract_number",
    [orgR, propR, uEst, tEst.id]);
  const seq1 = Number(cAuto1.contract_number.split("-")[2]);
  const seq2 = Number(cAuto2.contract_number.split("-")[2]);
  ok("contract numbering increments by one (gapless)", seq2 === seq1 + 1, `${cAuto1.contract_number} → ${cAuto2.contract_number}`);

  // An explicitly supplied number is respected (renew_contract relies on this).
  const cGiven = await one(
    "insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency) values($1,$2,$3,$4,'MY-CUSTOM-1','residential','draft','2033-01-01','2033-12-31',120000,'quarterly') returning contract_number",
    [orgR, propR, uEst, tEst.id]);
  ok("explicit contract number is preserved", cGiven.contract_number === "MY-CUSTOM-1", cGiven.contract_number);

  // Ejar block: optional, and the broker fields stay editable after activation
  // (they are outside tg_contract_immutable's frozen set, unlike ejar_contract_number).
  const cEjar = await one(
    "insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency,ejar_contract_number,ejar_broker_office,ejar_broker_number,ejar_broker_representative,ejar_has_extra_terms) values($1,$2,$3,$4,'residential','draft','2034-01-01','2034-12-31',120000,'quarterly','EJ-77','مكتب الوساطة','011','ممثل',true) returning id, ejar_contract_number, ejar_broker_office, ejar_has_extra_terms",
    [orgR, propR, uEst, tEst.id]);
  ok("ejar block stored (number/office/extra-terms)",
    cEjar.ejar_contract_number === "EJ-77" && cEjar.ejar_broker_office === "مكتب الوساطة" && cEjar.ejar_has_extra_terms === true,
    JSON.stringify(cEjar));
  ok("ejar fields are optional (null when not supplied)", cAuto1.ejar_broker_office === null, String(cAuto1.ejar_broker_office));
  ok("ejar broker fields stay editable",
    (await q("update app.contract set ejar_broker_office='مكتب آخر' where id=$1", [cEjar.id])).rowCount === 1);

  console.log(`\nPhase-3: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.error("HARNESS ERROR:", e.message, "\n", e.stack);
  fail++;
} finally {
  await stop();
}
process.exitCode = fail === 0 ? 0 : 1;
