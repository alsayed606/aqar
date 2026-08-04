// Organization profile (migration 0066) — the office's own legal identity.
//
// Three claims are worth proving here, because each of them is invisible when it fails:
//   1. a malformed tax number / IBAN / postal code is refused by the DATABASE, not only by the form;
//   2. a member who is not an admin does not get an error when they try to edit — their UPDATE
//      matches zero rows and reports success, which is why the server action asks for the rows back;
//   3. every change is written to the audit log with the previous tax identity.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54357);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const attempt = async (sql, params) => {
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
};

// A session that looks like a PostgREST request: JWT subject, active-org header, role `authenticated`.
// Rolled back afterwards, so one case never seeds the next.
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

// A real Saudi IBAN shape with a correct mod-97 checksum (SA + 22 digits).
const GOOD_IBAN = "SA0380000000608010167519";

try {
  // ---------------- Seed ----------------
  const org = (await one("insert into app.organization(name) values('مكتب الإعدادات') returning id")).id;
  const orgB = (await one("insert into app.organization(name) values('مكتب آخر') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [orgB]);

  const idAdmin = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000801','+966500000801','مدير') returning id")).id;
  const idStaff = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000802','+966500000802','موظّف') returning id")).id;
  const idOther = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000803','+966500000803','غريب') returning id")).id;
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idAdmin, org]);
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'staff','active',true)", [idStaff, org]);
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idOther, orgB]);

  console.log("\n— Column shape —");
  const cols = (await q(
    `select column_name from information_schema.columns
      where table_schema='app' and table_name='organization'`,
  )).rows.map((r) => r.column_name);
  for (const c of [
    "fal_license_no", "contact_phone", "contact_email", "logo_path",
    "address_building_no", "address_street", "address_district", "address_city",
    "address_postal_code", "address_additional_no",
    "bank_name", "iban", "bank_account_name",
  ]) {
    ok(`organization.${c} exists`, cols.includes(c));
  }

  console.log("\n— Format checks (the database, not the form) —");
  const badVat = await attempt("update app.organization set vat_number='12345' where id=$1", [org]);
  ok("a 5-digit VAT number is refused", !badVat.ok && /organization_vat_number_chk/.test(badVat.error ?? ""), badVat.error);

  const wrongEdgeVat = await attempt("update app.organization set vat_number='412345678901234' where id=$1", [org]);
  ok("a 15-digit VAT number not starting with 3 is refused", !wrongEdgeVat.ok, "accepted");

  const goodVat = await attempt("update app.organization set vat_number='312345678901233' where id=$1", [org]);
  ok("a well-formed VAT number is accepted", goodVat.ok, goodVat.error);

  const badCr = await attempt("update app.organization set cr_number='123' where id=$1", [org]);
  ok("a 3-digit CR number is refused", !badCr.ok, "accepted");
  ok("a 10-digit CR number is accepted", (await attempt("update app.organization set cr_number='1010101010' where id=$1", [org])).ok);

  const badIban = await attempt("update app.organization set iban='SA1234' where id=$1", [org]);
  ok("a short IBAN is refused", !badIban.ok && /organization_iban_chk/.test(badIban.error ?? ""), badIban.error);
  ok("a 24-character Saudi IBAN is accepted", (await attempt("update app.organization set iban=$2 where id=$1", [org, GOOD_IBAN])).ok);

  ok("a 3-digit postal code is refused", !(await attempt("update app.organization set address_postal_code='123' where id=$1", [org])).ok);
  ok("a 5-digit postal code is accepted", (await attempt("update app.organization set address_postal_code='12345' where id=$1", [org])).ok);
  ok("a 3-digit building number is refused", !(await attempt("update app.organization set address_building_no='123' where id=$1", [org])).ok);
  ok("a non-numeric فال licence is refused", !(await attempt("update app.organization set fal_license_no='FAL-99' where id=$1", [org])).ok);

  // NULL is how "not collected yet" is stored. A check that also rejected NULL would force an office
  // to invent a tax number on the day it signs up.
  ok("every new field may stay empty", (await attempt(
    `update app.organization set vat_number=null, cr_number=null, iban=null,
       fal_license_no=null, address_postal_code=null, address_building_no=null where id=$1`, [org])).ok);

  console.log("\n— Who may edit —");
  const adminWrite = await asRole(idAdmin, org, async () => {
    const r = await q("update app.organization set name='مكتب الإعدادات المحدّث' where id=$1 returning id", [org]);
    return r.rowCount;
  });
  ok("an org owner/admin can edit the profile", adminWrite.ok && adminWrite.value === 1, adminWrite.error);

  // The point of this one: NOT an error. `staff` passes the SELECT policy and fails the UPDATE
  // policy, so the statement is legal and matches nothing. A caller that only checks `error` would
  // report "saved" to someone whose change was silently dropped.
  const staffWrite = await asRole(idStaff, org, async () => {
    const r = await q("update app.organization set name='محاولة موظّف' where id=$1 returning id", [org]);
    return r.rowCount;
  });
  ok("a non-admin member's edit raises nothing…", staffWrite.ok, staffWrite.error);
  ok("…and changes zero rows", staffWrite.value === 0, `rowCount=${staffWrite.value}`);

  const crossOrg = await asRole(idOther, orgB, async () => {
    const r = await q("update app.organization set name='اختراق' where id=$1 returning id", [org]);
    return r.rowCount;
  });
  ok("an admin of another office changes zero rows here", crossOrg.ok && crossOrg.value === 0, crossOrg.error);

  console.log("\n— Audit —");
  // audit_log is append-only from line one (0011), so the baseline is counted, never cleared. Both
  // updates below land in one transaction and therefore share a created_at — the assertions match on
  // content rather than on order, which no timestamp can settle here.
  const auditCount = async () =>
    (await one("select count(*)::int as n from app.audit_log where org_id=$1 and action='org.profile_update'", [org])).n;

  const audited = await asRole(idAdmin, org, async () => {
    await q("update app.organization set vat_number='312345678901233' where id=$1", [org]);
    await q("update app.organization set vat_number='399999999999993', bank_name='الراجحي' where id=$1", [org]);
    // Scoped to this signed-in user: the format-check block above ran as superuser with no
    // auth.uid(), so filtering by author separates this section's rows from those without
    // depending on an ordering the two rows do not have.
    const rows = (await q(
      `select detail from app.audit_log
        where org_id=$1 and action='org.profile_update' and identity_id=$2`, [org, idAdmin])).rows;
    return rows.map((r) => r.detail);
  });
  const details = audited.value ?? [];
  ok("each profile change writes an audit row", details.length === 2, `rows=${details.length}`);

  const second = details.find((d) => d.vat_from === "312345678901233");
  ok("the audit keeps the PREVIOUS tax number", Boolean(second), JSON.stringify(details));
  ok("the audit names the fields that changed",
    Array.isArray(second?.fields) && second.fields.includes("vat_number") && second.fields.includes("bank_name"),
    JSON.stringify(second));
  ok("a non-identity field is named but its value is not copied", second?.bank_name === undefined);

  const noop = await asRole(idAdmin, org, async () => {
    const before = await auditCount();
    await q("update app.organization set name = name where id=$1", [org]);
    return (await auditCount()) - before;
  });
  ok("an update that changes nothing writes no audit row", noop.value === 0, `delta=${noop.value}`);

  console.log("\n— The storage-policy helper —");
  // The logo policies call this on a path segment. If it raised instead of returning null, a
  // hand-made object path would turn a denial into a 500.
  ok("uuid_or_null returns null for a non-uuid", (await one("select app.uuid_or_null('../etc/passwd') as v")).v === null);
  ok("uuid_or_null parses a uuid", (await one("select app.uuid_or_null($1) as v", [org])).v === org);
  ok("is_member_of(null) is false, not an error", (await one("select app.is_member_of(null) as v")).v === false);
} catch (e) {
  fail++;
  console.log("  FAIL  suite crashed -> " + e.message);
} finally {
  await stop();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
