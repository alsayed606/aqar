// The contract form's financial summary (lib/contract-finance.ts) against the database that
// actually creates the charges (app.activate_contract, migration 0019).
//
// Asserting the arithmetic against itself would prove nothing: the whole risk in showing money
// before it is committed is that the screen and the schedule drift apart. So every case here
// activates a REAL contract, reads back the REAL charges, and demands the same numbers.
import { bootWithMigrations } from "./_pgutil.mjs";
import { contractFinance } from "../../../lib/contract-finance.ts";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54358);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// Amounts in halalas, chosen so several of them do NOT divide evenly by their period count — an
// even split is the case that hides a remainder bug.
const CASES = [
  { rent: 12000000, kind: "residential", frequency: "quarterly",   note: "سكني ربع سنوي، قسمة تامّة" },
  { rent: 12000000, kind: "commercial",  frequency: "quarterly",   note: "تجاري ربع سنوي، قسمة تامّة" },
  { rent: 10000000, kind: "commercial",  frequency: "monthly",     note: "تجاري شهري، باقٍ ٤ هللات" },
  { rent: 1234567,  kind: "commercial",  frequency: "monthly",     note: "مبلغ كسريّ شهري" },
  { rent: 1234567,  kind: "residential", frequency: "monthly",     note: "مبلغ كسريّ شهري معفى" },
  { rent: 999999,   kind: "commercial",  frequency: "semi_annual", note: "نصف سنوي، باقٍ هللة" },
  { rent: 555555,   kind: "commercial",  frequency: "annual",      note: "سنوي، دفعة واحدة" },
  { rent: 777777,   kind: "commercial",  frequency: "one_time",    note: "دفعة واحدة" },
  { rent: 10,       kind: "commercial",  frequency: "annual",      note: "نصف هللة بالضبط — حدّ التقريب" },
];

try {
  // ---------------- Seed ----------------
  const org = (await one("insert into app.organization(name) values('مكتب الحساب') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);
  const ownerParty = (await one(
    "insert into app.party(org_id,display_name,roles) values($1,'المكتب',array['owner']::app.party_role[]) returning id", [org])).id;
  const owner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,true) returning id", [org, ownerParty])).id;
  const property = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج الحساب') returning id", [org, owner])).id;
  const tenantParty = (await one(
    "insert into app.party(org_id,display_name,national_id,roles) values($1,'مستأجر','1000000001',array['tenant']::app.party_role[]) returning id", [org])).id;
  const tenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, tenantParty])).id;

  let index = 0;
  for (const c of CASES) {
    index += 1;
    // A fresh unit per case: the one-active-contract-per-unit index would reject the second.
    const unit = (await one(
      "insert into app.unit(org_id,property_id,unit_number) values($1,$2,$3) returning id", [org, property, `U${index}`])).id;
    const contract = (await one(
      `insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,
                                start_date,end_date,annual_rent_halalas,payment_frequency)
       values($1,$2,$3,$4,$5,$6,'draft',date '2026-01-01',date '2026-12-31',$7,$8) returning id`,
      [org, property, unit, tenant, `CT-F-${index}`, c.kind, c.rent, c.frequency])).id;

    await q("select app.activate_contract($1)", [contract]);
    const charges = (await q(
      `select amount_excl_vat_halalas::int excl, vat_amount_halalas::int vat
         from app.charge where contract_id=$1 and deleted_at is null order by due_date`, [contract])).rows;

    const screen = contractFinance(c.rent, c.kind, c.frequency);
    const label = `${c.note} (${c.rent} هللة)`;

    if (!screen) {
      ok(label, false, "the summary returned nothing");
      continue;
    }

    const dbExcl = charges.map((r) => r.excl);
    const dbVat = charges.map((r) => r.vat);
    const dbVatTotal = dbVat.reduce((a, b) => a + b, 0);
    const dbExclTotal = dbExcl.reduce((a, b) => a + b, 0);

    const expectedExcl = Array.from({ length: screen.periods }, (_, i) =>
      i === screen.periods - 1 ? screen.lastInstalment : screen.instalment);

    ok(`${label} — عدد الدفعات`, screen.periods === charges.length,
      `screen=${screen.periods} db=${charges.length}`);
    ok(`${label} — مبالغ الدفعات`, JSON.stringify(expectedExcl) === JSON.stringify(dbExcl),
      `screen=${JSON.stringify(expectedExcl)} db=${JSON.stringify(dbExcl)}`);
    ok(`${label} — إجمالي الضريبة`, screen.vat === dbVatTotal, `screen=${screen.vat} db=${dbVatTotal}`);
    ok(`${label} — الإجمالي شاملاً الضريبة`, screen.total === dbExclTotal + dbVatTotal,
      `screen=${screen.total} db=${dbExclTotal + dbVatTotal}`);
    ok(`${label} — قيمة الدفعة الأولى شاملة`, screen.instalmentTotal === dbExcl[0] + dbVat[0],
      `screen=${screen.instalmentTotal} db=${dbExcl[0] + dbVat[0]}`);
    ok(`${label} — قيمة الدفعة الأخيرة شاملة`,
      screen.lastInstalmentTotal === dbExcl[dbExcl.length - 1] + dbVat[dbVat.length - 1],
      `screen=${screen.lastInstalmentTotal} db=${dbExcl.at(-1) + dbVat.at(-1)}`);
    // The rent the office typed must survive the split intact. A schedule that loses a halala is
    // a schedule the tenant under-pays for a year.
    ok(`${label} — مجموع الدفعات = الإيجار المُدخَل`, dbExclTotal === c.rent, `db=${dbExclTotal}`);
  }

  console.log("\n— Guards —");
  ok("no rent yet → no summary at all", contractFinance(0, "commercial", "quarterly") === null);
  ok("a negative amount produces no summary", contractFinance(-100, "commercial", "quarterly") === null);
  ok("a nonsense amount produces no summary", contractFinance(NaN, "commercial", "quarterly") === null);
  // A frequency the form does not offer must not silently become twelve instalments.
  ok("an unknown frequency falls back to one instalment",
    contractFinance(100000, "commercial", "لا-شيء")?.periods === 1);
  ok("an unknown contract kind is treated as exempt, never as taxed",
    contractFinance(100000, "لا-شيء", "annual")?.vat === 0);
} catch (e) {
  fail++;
  console.log("  FAIL  suite crashed -> " + e.message);
} finally {
  await stop();
}

console.log(`\nContract finance: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
