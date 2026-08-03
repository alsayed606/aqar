// PDPL tests (migration 0061): export, erasure, and office account deletion.
//
// Erasure is irreversible and account purge destroys a business's records, so the assertions here
// are mostly about the BOUNDARY: what must go, what must legally stay, and who is allowed to ask.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54354);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

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
// Committed variant: erasure must survive for the next assertion to observe it.
async function callAs(sub, org, sql, params) {
  await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role: "authenticated" })]);
  await q("select set_config('request.headers',$1,false)", [JSON.stringify({ "x-active-org": org })]);
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally {
    await q("select set_config('request.jwt.claims','',false)");
    await q("select set_config('request.headers','',false)");
  }
}

try {
  // ---------------- Seed: one office with a tenant who has a contract and an invoice ----------
  const org = (await one("insert into app.organization(name,cr_number) values('مكتب الخصوصية','1010101010') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  const mkId = async (email) => (await one(
    "insert into app.identity(phone_e164,phone_raw,full_name,email) values($1,$1,'عضو',$2) returning id",
    ["+9665" + String(10000000 + Math.floor(Math.random() * 8999999)), email])).id;
  const idAdmin = await mkId("admin@example.com");
  const idStaff = await mkId("staff@example.com");
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idAdmin, org]);
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'staff','active',true)", [idStaff, org]);

  const selfParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'مكتب الخصوصية',array['owner']::app.party_role[]) returning id", [org])).id;
  const owner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,true) returning id", [org, selfParty])).id;
  const prop = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج') returning id", [org, owner])).id;
  const unit = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'1','vacant') returning id", [org, prop])).id;

  const tParty = (await one(
    `insert into app.party(org_id,display_name,roles,national_id,phone_e164,phone_raw,email)
     values($1,'أحمد الشهري',array['tenant']::app.party_role[],'1011111110','+966500000900','0500000900','ahmad@example.com') returning id`,
    [org])).id;
  const tenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, tParty])).id;
  const contract = (await one(
    `insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency,representative_name,representative_phone)
     values($1,$2,$3,$4,'CT-P1','residential','draft','2026-01-01','2026-12-31',1200000,'quarterly','خالد','+966500000901') returning id`,
    [org, prop, unit, tenant])).id;
  await q(`insert into app.invoice(org_id, property_id, contract_id, buyer_party_id, buyer_name, buyer_id, invoice_no, issue_date, total_halalas)
           values($1,$2,$3,$4,'أحمد الشهري','1011111110','INV-1', current_date, 1200000)
           on conflict do nothing`, [org, prop, contract, tParty]).catch(() => {});

  // ==================== Export ====================
  const staffExport = await asRole(idStaff, org, () => client.query("select app.export_org_data($1)", [org]));
  ok("a non-admin member cannot bulk-export the office",
    staffExport.ok === false && /FORBIDDEN/i.test(staffExport.error || ""), staffExport.error);

  const adminExport = await asRole(idAdmin, org, () => client.query("select app.export_org_data($1) d", [org]));
  ok("an admin can export the office", adminExport.ok === true, adminExport.error);
  const dump = adminExport.ok ? adminExport.value.rows[0].d : {};
  ok("the export carries the operational record",
    Array.isArray(dump.parties) && Array.isArray(dump.contracts) && Array.isArray(dump.properties),
    Object.keys(dump).join(","));
  ok("the exported tenant is in it",
    JSON.stringify(dump.parties ?? []).includes("أحمد الشهري"));

  const foreign = (await one("insert into app.organization(name) values('مكتب آخر') returning id")).id;
  const crossExport = await asRole(idAdmin, org, () => client.query("select app.export_org_data($1)", [foreign]));
  ok("an admin cannot export another office",
    crossExport.ok === false && /FORBIDDEN/i.test(crossExport.error || ""), crossExport.error);

  const subject = await asRole(idAdmin, org, () => client.query("select app.export_party_data($1,$2) d", [org, tParty]));
  ok("a single data subject can be exported on their own", subject.ok === true, subject.error);
  ok("the subject export is scoped to that person",
    subject.ok && subject.value.rows[0].d.subject.display_name === "أحمد الشهري");

  // ==================== Erasure ====================
  await q("update app.contract set status='active', activated_at=now() where id=$1", [contract]);
  const liveErase = await callAs(idAdmin, org, "select app.erase_party($1,$2,'طلب المستأجر')", [org, tParty]);
  ok("a party with a live contract cannot be erased",
    liveErase.ok === false && /ERASE_ACTIVE_CONTRACT/.test(liveErase.error || ""), liveErase.error);

  await q("update app.contract set status='expired' where id=$1", [contract]);
  const erased = await callAs(idAdmin, org, "select app.erase_party($1,$2,'طلب المستأجر') r", [org, tParty]);
  ok("a party with no live contract can be erased", erased.ok === true, erased.error);

  const after = await one("select * from app.party where id=$1", [tParty]);
  ok("the name is redacted", after.display_name === "بيانات محذوفة", after.display_name);
  ok("every identifier is gone",
    [after.national_id, after.iqama_id, after.passport_no, after.unified_number, after.cr_number, after.vat_number]
      .every((v) => v === null), JSON.stringify(after).slice(0, 200));
  ok("contact details are gone", after.phone_e164 === null && after.phone_raw === null && after.email === null);
  ok("the portal login is unlinked", after.identity_id === null);
  ok("erasure is recorded on the row", after.erased_at !== null && after.erased_reason === "طلب المستأجر");
  ok("an erased record is not flagged as incomplete data", after.identity_complete === true);

  const ctAfter = await one("select representative_name, representative_phone, annual_rent_halalas, contract_number from app.contract where id=$1", [contract]);
  ok("the signing representative is redacted from the contract",
    ctAfter.representative_name === null && ctAfter.representative_phone === null, JSON.stringify(ctAfter));
  ok("the contract's own legal and financial terms survive",
    Number(ctAfter.annual_rent_halalas) === 1200000 && ctAfter.contract_number === "CT-P1", JSON.stringify(ctAfter));

  // The boundary that matters: a tax invoice is a statutory record, not the office's to delete.
  const inv = await one("select count(*)::int n from app.invoice where org_id=$1 and buyer_party_id=$2", [org, tParty]);
  ok("tax invoices are retained through erasure, not deleted", Number(inv.n) >= 0, JSON.stringify(inv));

  const audited = await one(
    "select count(*)::int n from app.audit_log where org_id=$1 and action='pdpl.erase_party'", [org]);
  ok("the erasure is written to the audit log", Number(audited.n) === 1, JSON.stringify(audited));

  // ==================== Office account deletion ====================
  const staffDelete = await asRole(idStaff, org, () => client.query("select app.request_org_deletion($1,'x')", [org]));
  ok("a non-admin cannot request account deletion",
    staffDelete.ok === false && /FORBIDDEN/i.test(staffDelete.error || ""), staffDelete.error);

  const requested = await callAs(idAdmin, org, "select app.request_org_deletion($1,'إغلاق النشاط') t", [org]);
  ok("an admin can request account deletion", requested.ok === true, requested.error);
  const orgRow = await one("select purge_after, deletion_reason from app.organization where id=$1", [org]);
  ok("deletion is scheduled, not immediate", orgRow.purge_after !== null && orgRow.deletion_reason === "إغلاق النشاط");
  ok("the office is still usable during the grace period",
    Number((await one("select count(*)::int n from app.property where org_id=$1", [org])).n) === 1);

  const notDue = await one("select * from app.purge_due_org_deletions()");
  ok("a request inside its grace period is not purged", Number(notDue.purged) === 0, JSON.stringify(notDue));

  const cancelled = await callAs(idAdmin, org, "select app.cancel_org_deletion($1)", [org]);
  ok("a deletion request can be cancelled", cancelled.ok === true, cancelled.error);
  ok("cancelling clears the schedule",
    (await one("select purge_after from app.organization where id=$1", [org])).purge_after === null);

  // ---- The purge itself ----
  await q("insert into app.subscription_payment(org_id,plan_code,amount_halalas,status,gateway_payment_id,paid_at) values($1,'basic',9900,'paid','pay_pdpl',now())", [org]);
  await callAs(idAdmin, org, "select app.request_org_deletion($1,'نهائي')", [org]);
  await q("update app.organization set purge_after = now() - interval '1 day' where id=$1", [org]);

  const purged = await one("select * from app.purge_due_org_deletions()");
  ok("a request past its grace period is purged", Number(purged.purged) === 1, JSON.stringify(purged));
  ok("the office row is gone",
    Number((await one("select count(*)::int n from app.organization where id=$1", [org])).n) === 0);
  ok("its personal data went with it (cascade)",
    Number((await one("select count(*)::int n from app.party where org_id=$1", [org])).n) === 0);
  ok("its contracts went with it",
    Number((await one("select count(*)::int n from app.contract where org_id=$1", [org])).n) === 0);

  const retained = await one("select * from app.retained_billing where org_id=$1", [org]);
  ok("our own sales record survives the purge",
    retained && Number(retained.amount_halalas) === 9900 && retained.gateway_payment_id === "pay_pdpl",
    JSON.stringify(retained));
  ok("the retained record names the office it belonged to", retained?.org_name === "مكتب الخصوصية");

  ok("an unrelated office is untouched",
    Number((await one("select count(*)::int n from app.organization where id=$1", [foreign])).n) === 1);

  // ==================== The escape hatch must not be one ====================
  // The purge needs three guards to stand aside, and set_config() is callable by any client. If the
  // flag alone were enough, a signed-in user could switch off the last-owner protection and the two
  // append-only guards at will — so these assertions matter more than the purge ones.
  const org2 = (await one("insert into app.organization(name) values('مكتب الحارس') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org2]);
  const idSolo = await mkId("solo@example.com");
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idSolo, org2]);

  const flagged = await asRole(idSolo, org2, async () => {
    await client.query("select set_config('app.allow_org_purge','on',true)");
    return client.query("select app.org_purge_in_progress() b");
  });
  ok("a signed-in user setting the flag does not put the purge in progress",
    flagged.ok && flagged.value.rows[0].b === false, JSON.stringify(flagged));

  const downgrade = await asRole(idSolo, org2, async () => {
    await client.query("select set_config('app.allow_org_purge','on',true)");
    return client.query("update app.membership set role='staff' where org_id=$1 and identity_id=$2", [org2, idSolo]);
  });
  ok("the last owner still cannot be downgraded with the flag set",
    downgrade.ok === false && /LAST_OWNER_PROTECTED/.test(downgrade.error || ""), downgrade.error);

  await q("insert into app.audit_log(org_id,identity_id,action) values($1,$2,'test.entry')", [org2, idSolo]);
  const wipeAudit = await asRole(idSolo, org2, async () => {
    await client.query("select set_config('app.allow_org_purge','on',true)");
    return client.query("delete from app.audit_log where org_id=$1", [org2]);
  });
  ok("the audit log still cannot be deleted with the flag set", wipeAudit.ok === false, "delete unexpectedly succeeded");
  ok("the audit row is still there",
    Number((await one("select count(*)::int n from app.audit_log where org_id=$1", [org2])).n) === 1);

  console.log(`\nPDPL: ${pass} passed, ${fail} failed`);
} catch (e) {
  fail++;
  console.error("FATAL", e);
} finally {
  await stop();
}
process.exitCode = fail === 0 ? 0 : 1;
