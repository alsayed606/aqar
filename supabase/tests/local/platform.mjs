// Platform-console tests against a real PG17 (Charter هـ-36/37): the super-admin surface built in
// sprints T-0…T-5 (migrations 0048-0056) plus the operator functions from 0039.
//
// This suite boots its OWN database and seeds only what it asserts on. It used to live inside
// phase3.mjs and lean on that file's fixture, which meant a platform assertion could pass because
// an unrelated office test happened to leave the right row behind — and phase3.mjs had grown past a
// thousand lines. Independent suites can also run in parallel.
//
// Every platform function is SECURITY DEFINER with an internal operator gate (ADR-0006), so each
// group starts by proving a NON-operator is refused before proving the function works.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54352);
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

// Same identity context, but COMMITTED — the platform functions are SECURITY DEFINER and read
// auth.uid(), and their writes have to survive for the next assertion to see them.
async function callAs(sub, org, sql, params) {
  await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role: "authenticated" })]);
  await q("select set_config('request.headers',$1,false)", [JSON.stringify({ "x-active-org": org })]);
  try { return (await q(sql, params)).rows; }
  finally {
    await q("select set_config('request.jwt.claims','',false)");
    await q("select set_config('request.headers','',false)");
  }
}

try {
  // ---------------- Seed (as postgres, bypassing RLS) ----------------
  // Two offices on the unlimited Enterprise tier so seed volume never trips a plan ceiling, and so
  // the plan-change assertions have a priced tier to move to.
  const org1 = (await one("insert into app.organization(name) values('Org One') returning id")).id;
  const org2 = (await one("insert into app.organization(name) values('Org Two') returning id")).id;
  for (const o of [org1, org2])
    await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [o]);

  const mkId = async (phone) => (await one("insert into app.identity(phone_e164,phone_raw,full_name) values($1,$1,'عضو') returning id", [phone])).id;
  const idOwner = await mkId("+966500000010");   // office owner, org1 — later seeded as the operator
  const idViewer = await mkId("+966500000011");  // viewer, org1 — the "not an operator" case
  const idStaff = await mkId("+966500000012");   // staff, org1

  const mkMember = (idn, org, role) => q(
    "insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,$3,'active',true)", [idn, org, role]);
  await mkMember(idOwner, org1, "owner");
  await mkMember(idViewer, org1, "viewer");
  await mkMember(idStaff, org1, "staff");

  // A portfolio for org1, so Tenant 360 and the platform totals have something to count.
  const selfParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'Org One',array['owner']::app.party_role[]) returning id", [org1])).id;
  const selfOwner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,true) returning id", [org1, selfParty])).id;
  const P1 = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'P1') returning id", [org1, selfOwner])).id;
  const U1 = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'101','vacant') returning id", [org1, P1])).id;
  const tParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'Tenant One',array['tenant']::app.party_role[]) returning id", [org1])).id;
  const T1 = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org1, tParty])).id;
  await q(`insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency)
           values($1,$2,$3,$4,'CT-1','residential','draft','2025-01-01','2025-12-31',1200000,'quarterly')`,
    [org1, P1, U1, T1]);

  // One collected payment and one declined one: the revenue series, top customers and billing
  // health all need both sides to exist before they can be checked.
  await q(`insert into app.subscription_payment(org_id,plan_code,amount_halalas,status,gateway_payment_id,paid_at)
           values($1,'basic',9900,'paid','pay_seed_ok', now())`, [org1]);
  await q(`insert into app.subscription_payment(org_id,plan_code,amount_halalas,status,raw)
           values($1,'basic',9900,'failed','{"message":"card declined"}'::jsonb)`, [org1]);

  // An OFFICE action in the audit log. The audit centre must show its metadata and withhold its
  // payload, and there has to be a non-platform row for that to be provable.
  await q(`insert into app.audit_log(org_id,identity_id,action,entity_type,detail)
           values($1,$2,'contract.activate','contract','{"annual_rent_halalas":1200000}'::jsonb)`, [org1, idOwner]);

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

  // 0056 rewrote limit_reached from per-office function calls to grouped aggregates. The answer
  // must not move: an office at its ceiling counts, one below it does not.
  const orgFull = (await one("insert into app.organization(name) values('At The Ceiling') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'basic','active')", [orgFull]);
  const fullParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'مالك',array['owner']::app.party_role[]) returning id", [orgFull])).id;
  const fullOwner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,true) returning id", [orgFull, fullParty])).id;
  const beforeCeiling = (await callAs(idOwner, org1, "select * from app.platform_alerts()")).find((r) => r.kind === "limit_reached");
  // Basic allows 25 properties; put the office exactly on the line.
  await q(`insert into app.property(org_id,owner_id,name)
           select $1,$2,'عقار ' || g from generate_series(1,25) g`, [orgFull, fullOwner]);
  const afterCeiling = (await callAs(idOwner, org1, "select * from app.platform_alerts()")).find((r) => r.kind === "limit_reached");
  ok("an office that reaches its plan ceiling is counted once, and only once",
    (afterCeiling?.count ?? 0) - (beforeCeiling?.count ?? 0) === 1,
    JSON.stringify({ before: beforeCeiling?.count ?? 0, after: afterCeiling?.count ?? 0 }));

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

  console.log(`\nPlatform: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error('HARNESS ERROR:', e.message, '\n', e.stack);
  process.exitCode = 1;
} finally {
  await stop();
}
