// Utilities module tests (migration 0063). See docs/foundation/09-utilities-module.md.
//
// Two rules carry this module and both are easy to get subtly wrong, so most of the file is about
// them: what consumption is when a meter is replaced or misread, and who bears a bill for a month
// that is not this month.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54355);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const attempt = async (sql, params) => {
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
};

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

const mkMeter = (org, prop, unit, type, number, extra = "") =>
  attempt(
    `insert into app.utility_meter(org_id, property_id, unit_id, utility_type, meter_number ${extra ? "," + extra.split("=")[0] : ""})
     values($1,$2,$3,$4,$5 ${extra ? "," + extra.split("=")[1] : ""}) returning id, meter_level, status`,
    [org, prop, unit, type, number],
  );

try {
  // ---------------- Seed ----------------
  const org = (await one("insert into app.organization(name) values('مكتب المرافق') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  const ownerParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'مالك المبنى',array['owner']::app.party_role[]) returning id", [org])).id;
  const owner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id", [org, ownerParty])).id;
  const propA = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج أ') returning id", [org, owner])).id;
  const propB = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج ب') returning id", [org, owner])).id;
  const unitA1 = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'101','vacant') returning id", [org, propA])).id;
  const unitA2 = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'102','vacant') returning id", [org, propA])).id;
  const unitB1 = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'201','vacant') returning id", [org, propB])).id;

  // ==================== The six scenarios the brief demanded ====================
  const mainE = await mkMeter(org, propA, null, "electricity", "E-MAIN-1");
  ok("a property can have one main electricity meter", mainE.ok, mainE.error);
  ok("meter_level is derived as 'main' when no unit is set", mainE.rows?.[0].meter_level === "main");

  const mainE2 = await mkMeter(org, propA, null, "electricity", "E-MAIN-2");
  ok("a property can have SEVERAL main meters", mainE2.ok, mainE2.error);

  const mainW = await mkMeter(org, propA, null, "water", "W-MAIN-1");
  const mainW2 = await mkMeter(org, propA, null, "water", "W-MAIN-2");
  ok("a property can have several main water meters", mainW.ok && mainW2.ok, mainW.error || mainW2.error);

  const unitMeter = await mkMeter(org, propA, unitA1, "electricity", "E-101");
  ok("a unit can have its own meter", unitMeter.ok, unitMeter.error);
  ok("meter_level is derived as 'unit' when a unit is set", unitMeter.rows?.[0].meter_level === "unit");

  const unitMeter2 = await mkMeter(org, propA, unitA1, "water", "W-101");
  const unitMeter3 = await mkMeter(org, propA, unitA1, "electricity", "E-101-B");
  ok("the same unit can carry MORE THAN ONE meter of the same type", unitMeter2.ok && unitMeter3.ok,
    unitMeter2.error || unitMeter3.error);

  ok("main and unit meters coexist on one property",
    Number((await one("select count(*)::int n from app.utility_meter where property_id=$1", [propA])).n) === 7);
  ok("a property with no meters at all is untouched",
    Number((await one("select count(*)::int n from app.utility_meter where property_id=$1", [propB])).n) === 0);

  // ==================== Constraints ====================
  const crossProperty = await mkMeter(org, propA, unitB1, "electricity", "E-CROSS");
  ok("a unit from ANOTHER property is refused by the database",
    !crossProperty.ok && /foreign key|unit/i.test(crossProperty.error || ""), crossProperty.error);

  const dupNumber = await mkMeter(org, propB, null, "electricity", "E-MAIN-1");
  ok("a duplicate meter number in the same office and utility is refused",
    !dupNumber.ok && /utility_meter_number_uq|duplicate/i.test(dupNumber.error || ""), dupNumber.error);

  const sameNumberOtherType = await mkMeter(org, propB, null, "water", "E-MAIN-1");
  ok("the same number under a different utility is allowed", sameNumberOtherType.ok, sameNumberOtherType.error);

  const badStatus = await attempt(
    "update app.utility_meter set status='removed' where id=$1", [mainE2.rows[0].id]);
  ok("marking a meter removed without a removal date is refused",
    !badStatus.ok && /utility_meter_removed_chk/.test(badStatus.error || ""), badStatus.error);
  const goodRemoval = await attempt(
    "update app.utility_meter set status='removed', removed_at=current_date where id=$1", [mainE2.rows[0].id]);
  ok("removing a meter with its date is accepted", goodRemoval.ok, goodRemoval.error);

  // ==================== The consumption rule ====================
  const meter = unitMeter.rows[0].id;
  const addReading = (date, value, reset = false) =>
    attempt("insert into app.utility_reading(org_id,meter_id,reading_date,value,is_reset) values($1,$2,$3,$4,$5) returning id",
      [org, meter, date, value, reset]);

  const future = await addReading("2099-01-01", 10);
  ok("a reading dated in the future is refused",
    !future.ok && /READING_IN_FUTURE/.test(future.error || ""), future.error);
  const negative = await addReading("2026-01-05", -1);
  ok("a negative reading is refused", !negative.ok, "insert unexpectedly succeeded");

  await addReading("2026-01-31", 1000);
  const dupDate = await addReading("2026-01-31", 1200);
  ok("two readings on the same date for one meter are refused", !dupDate.ok, "insert unexpectedly succeeded");

  const readings = () => q(
    "select reading_date, value, consumption, needs_review from app.utility_consumption where meter_id=$1 order by reading_date",
    [meter]).then((r) => r.rows);

  let rows = await readings();
  ok("the first reading is a BASELINE, not consumption", rows[0].consumption === null, JSON.stringify(rows[0]));

  await addReading("2026-02-28", 1350);
  rows = await readings();
  ok("a normal reading consumes the difference", Number(rows[1].consumption) === 350, JSON.stringify(rows[1]));
  ok("a normal reading needs no review", rows[1].needs_review === false);

  // The case the whole rule exists for.
  await addReading("2026-03-31", 90);
  rows = await readings();
  ok("a reading LOWER than the last one yields no number at all",
    rows[2].consumption === null, JSON.stringify(rows[2]));
  ok("and it is flagged for review instead of guessed", rows[2].needs_review === true, JSON.stringify(rows[2]));

  // Declaring the replacement is the only thing that makes a lower reading meaningful.
  await q("update app.utility_reading set is_reset = true where meter_id=$1 and reading_date='2026-03-31'", [meter]);
  rows = await readings();
  ok("once declared a replaced meter, the reading itself IS the consumption",
    Number(rows[2].consumption) === 90, JSON.stringify(rows[2]));
  ok("and the review flag clears", rows[2].needs_review === false);

  // The OTHER answer the UI offers for a lower reading (U-2): it was a typo. Correcting the number
  // is enough on its own — consumption is a view over the readings, never a stored column, so
  // nothing has to be recomputed or kept in step by the application.
  await q("update app.utility_reading set is_reset = false, value = 1390 where meter_id=$1 and reading_date='2026-03-31'", [meter]);
  rows = await readings();
  ok("correcting a mistyped reading restores its consumption with no recompute step",
    Number(rows[2].consumption) === 40 && rows[2].needs_review === false, JSON.stringify(rows[2]));

  // And the correction propagates forward: the NEXT reading measures from the corrected value.
  await addReading("2026-04-30", 1500);
  rows = await readings();
  ok("a later reading measures from the corrected value, not the wrong one",
    Number(rows[3].consumption) === 110, JSON.stringify(rows[3]));

  // Restore the replaced-meter state the later assertions were written against.
  await q("delete from app.utility_reading where meter_id=$1 and reading_date='2026-04-30'", [meter]);
  await q("update app.utility_reading set is_reset = true, value = 90 where meter_id=$1 and reading_date='2026-03-31'", [meter]);

  // ==================== Bills ====================
  const addBill = (m, month, prev, cur, amount, due, paid = null) =>
    attempt(`insert into app.utility_bill(org_id,meter_id,billing_month,previous_reading,current_reading,
             amount_halalas,vat_halalas,other_fees_halalas,due_date,paid_at)
             values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, total_halalas, consumption, needs_review`,
      [org, m, month, prev, cur, amount, Math.round(amount * 0.15), 500, due, paid]);

  const midMonth = await addBill(meter, "2026-02-14", 1000, 1350, 80000, "2026-03-10");
  ok("a billing month that is not the first of a month is refused",
    !midMonth.ok && /utility_bill_month_chk/.test(midMonth.error || ""), midMonth.error);

  const bill = await addBill(meter, "2026-02-01", 1000, 1350, 80000, "2026-03-10");
  ok("a bill is accepted", bill.ok, bill.error);
  ok("the total is derived from amount + vat + fees",
    Number(bill.rows[0].total_halalas) === 80000 + 12000 + 500, JSON.stringify(bill.rows[0]));
  ok("bill consumption follows the same rule", Number(bill.rows[0].consumption) === 350);

  const backwards = await addBill(meter, "2026-04-01", 1350, 900, 5000, "2026-05-10");
  ok("a bill whose reading went backwards carries no consumption and is flagged",
    backwards.rows[0].consumption === null && backwards.rows[0].needs_review === true,
    JSON.stringify(backwards.rows[0]));

  const dupMonth = await addBill(meter, "2026-02-01", 1350, 1400, 9000, "2026-03-10");
  ok("two bills for the same meter and month are refused", !dupMonth.ok, "insert unexpectedly succeeded");

  // ==================== Who bears it ====================
  const mainBill = await addBill(mainE.rows[0].id, "2026-02-01", 0, 500, 40000, "2026-03-10");
  const mainView = await one("select bearer_kind, bearer_name from app.utility_bill_view where id=$1", [mainBill.rows[0].id]);
  ok("a MAIN meter's bill falls to the property owner",
    mainView.bearer_kind === "owner" && mainView.bearer_name === "مالك المبنى", JSON.stringify(mainView));

  const vacantView = await one("select bearer_kind, bearer_name from app.utility_bill_view where id=$1", [bill.rows[0].id]);
  ok("a bill on a VACANT unit falls to the owner too",
    vacantView.bearer_kind === "owner", JSON.stringify(vacantView));

  // A tenant who occupied the unit in February and left before today.
  const tParty = (await one(
    `insert into app.party(org_id,display_name,roles,national_id) values($1,'مستأجر فبراير',array['tenant']::app.party_role[],'1011111110') returning id`, [org])).id;
  const tenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, tParty])).id;
  await q(`insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency)
           values($1,$2,$3,$4,'CT-U1','residential','expired','2026-01-01','2026-03-31',1200000,'quarterly')`,
    [org, propA, unitA1, tenant]);

  const withTenant = await one("select bearer_kind, bearer_name, contract_id from app.utility_bill_view where id=$1", [bill.rows[0].id]);
  ok("a bill on a RENTED unit falls to that month's tenant",
    withTenant.bearer_kind === "tenant" && withTenant.bearer_name === "مستأجر فبراير", JSON.stringify(withTenant));
  ok("and it names the contract it was resolved from", withTenant.contract_id !== null);

  // The point of resolving against the billed month rather than today: April is after that lease
  // ended, so April must NOT be charged to February's tenant.
  const aprilView = await one("select bearer_kind from app.utility_bill_view where id=$1", [backwards.rows[0].id]);
  ok("a bill for a month AFTER the lease ended goes back to the owner",
    aprilView.bearer_kind === "owner", JSON.stringify(aprilView));

  // ==================== No financial effect ====================
  ok("recording utility bills creates no charge",
    Number((await one("select count(*)::int n from app.charge where org_id=$1", [org])).n) === 0);
  ok("recording utility bills creates no payment",
    Number((await one("select count(*)::int n from app.payment where org_id=$1", [org])).n) === 0);

  // ==================== RLS: property scope ====================
  const idFull = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000801','+966500000801','كامل') returning id")).id;
  const idScoped = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000802','+966500000802','مقيّد') returning id")).id;
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idFull, org]);
  const scopedMembership = (await one(
    "insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'staff','active',false) returning id", [idScoped, org])).id;
  // Scoped to property B only — which has exactly one meter.
  await q("insert into app.membership_property_scope(membership_id,property_id) values($1,$2)", [scopedMembership, propB]);

  const fullSees = await asRole(idFull, org, () => client.query("select count(*)::int n from app.utility_meter"));
  ok("an unrestricted member sees every meter in the office",
    fullSees.ok && fullSees.value.rows[0].n === 8, JSON.stringify(fullSees.value?.rows));

  const scopedSees = await asRole(idScoped, org, () => client.query("select count(*)::int n from app.utility_meter"));
  ok("a member scoped to one property sees ONLY that property's meters",
    scopedSees.ok && scopedSees.value.rows[0].n === 1, JSON.stringify(scopedSees.value?.rows));

  const scopedBills = await asRole(idScoped, org, () => client.query("select count(*)::int n from app.utility_bill_view"));
  ok("the derived view respects the same scope (security_invoker)",
    scopedBills.ok && scopedBills.value.rows[0].n === 0, JSON.stringify(scopedBills.value?.rows));

  const scopedReadings = await asRole(idScoped, org, () => client.query("select count(*)::int n from app.utility_consumption"));
  ok("readings of an out-of-scope property are invisible too",
    scopedReadings.ok && scopedReadings.value.rows[0].n === 0, JSON.stringify(scopedReadings.value?.rows));

  const orgOther = (await one("insert into app.organization(name) values('مكتب آخر') returning id")).id;
  const foreign = await asRole(idFull, orgOther, () => client.query("select count(*)::int n from app.utility_meter"));
  ok("meters of another office are invisible", foreign.ok && foreign.value.rows[0].n === 0, foreign.error);

  console.log(`\nUtilities: ${pass} passed, ${fail} failed`);
} catch (e) {
  fail++;
  console.error("FATAL", e);
} finally {
  await stop();
}
process.exitCode = fail === 0 ? 0 : 1;
