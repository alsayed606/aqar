// Archive guards (migration 0067).
//
// Before this, soft-deleting a property with live units and contracts succeeded in silence: the
// contracts stayed alive pointing at something that had vanished from every screen. The assertions
// below are about the two ways that can go wrong now — a refusal that does not happen, and a
// refusal that happens where it must not (PDPL erasure, org purge, import revert).
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54359);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const attempt = async (sql, params) => {
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
};
const archive = (table, id) =>
  attempt(`update app.${table} set deleted_at = now() where id = $1`, [id]);

try {
  // ---------------- Seed ----------------
  const org = (await one("insert into app.organization(name) values('مكتب الأرشفة') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  const selfParty = (await one(
    "insert into app.party(org_id,display_name,roles) values($1,'المكتب',array['owner']::app.party_role[]) returning id", [org])).id;
  const selfOwner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,true) returning id", [org, selfParty])).id;

  const clientParty = (await one(
    "insert into app.party(org_id,display_name,roles) values($1,'مالك عميل',array['owner']::app.party_role[]) returning id", [org])).id;
  const clientOwner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id", [org, clientParty])).id;

  const busyProp = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج مشغول') returning id", [org, clientOwner])).id;
  const emptyProp = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج فارغ') returning id", [org, selfOwner])).id;

  const busyUnit = (await one("insert into app.unit(org_id,property_id,unit_number) values($1,$2,'101') returning id", [org, busyProp])).id;
  const freeUnit = (await one("insert into app.unit(org_id,property_id,unit_number) values($1,$2,'102') returning id", [org, busyProp])).id;

  const tenantParty = (await one(
    "insert into app.party(org_id,display_name,national_id,roles) values($1,'مستأجر','1000000009',array['tenant']::app.party_role[]) returning id", [org])).id;
  const busyTenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, tenantParty])).id;
  const freeParty = (await one(
    "insert into app.party(org_id,display_name,national_id,roles) values($1,'مستأجر بلا عقد','1000000010',array['tenant']::app.party_role[]) returning id", [org])).id;
  const freeTenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, freeParty])).id;

  const draft = (await one(
    `insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,
                              start_date,end_date,annual_rent_halalas,payment_frequency)
     values($1,$2,$3,$4,'CT-A-1','residential','draft',date '2026-01-01',date '2026-12-31',1200000,'quarterly')
     returning id`, [org, busyProp, busyUnit, busyTenant])).id;

  console.log("\n— What must be refused —");
  const p = await archive("property", busyProp);
  ok("a property with units and contracts is refused", !p.ok && /HAS_DEPENDENTS/.test(p.error ?? ""), p.error);
  ok("…and the refusal carries the counts", /units=2/.test(p.error ?? "") && /contracts=1/.test(p.error ?? ""), p.error);

  const u = await archive("unit", busyUnit);
  ok("a unit with a contract is refused", !u.ok && /HAS_DEPENDENTS:contracts=1/.test(u.error ?? ""), u.error);

  const t = await archive("tenant", busyTenant);
  ok("a tenant with a contract is refused", !t.ok && /HAS_DEPENDENTS:contracts=1/.test(t.error ?? ""), t.error);

  const o = await archive("owner", clientOwner);
  ok("an owner holding a property is refused", !o.ok && /HAS_DEPENDENTS:properties=1/.test(o.error ?? ""), o.error);

  const so = await archive("owner", selfOwner);
  ok("the self-owner is refused outright", !so.ok && /SELF_OWNER_UNDELETABLE/.test(so.error ?? ""), so.error);
  // It must be the self-owner rule that fires, not the property count — the message the office reads
  // has to name the real reason, and the self-owner holds a property here too.
  ok("…for being the self-owner, not for its properties", !/HAS_DEPENDENTS/.test(so.error ?? ""), so.error);

  console.log("\n— What must still be allowed —");
  ok("a unit with no contract is archived", (await archive("unit", freeUnit)).ok);
  ok("a tenant with no contract is archived", (await archive("tenant", freeTenant)).ok);

  // Only after its one unit went. The counts are read live, not cached at trigger creation.
  const emptyU = (await one("insert into app.unit(org_id,property_id,unit_number) values($1,$2,'1') returning id", [org, emptyProp])).id;
  ok("a property is refused while its single unit lives", !(await archive("property", emptyProp)).ok);
  await q("update app.unit set deleted_at = now() where id = $1", [emptyU]);
  ok("…and archived once that unit is gone", (await archive("property", emptyProp)).ok);

  console.log("\n— Contracts —");
  ok("a draft contract is archived", (await archive("contract", draft)).ok);

  const active = (await one(
    `insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,
                              start_date,end_date,annual_rent_halalas,payment_frequency)
     values($1,$2,$3,$4,'CT-A-2','residential','draft',date '2026-01-01',date '2026-12-31',1200000,'quarterly')
     returning id`, [org, busyProp, busyUnit, busyTenant])).id;
  await q("select app.activate_contract($1)", [active]);
  const ac = await archive("contract", active);
  ok("an ACTIVE contract is refused", !ac.ok && /CONTRACT_ACTIVE_ARCHIVE/.test(ac.error ?? ""), ac.error);

  console.log("\n— Not an archive at all —");
  // The guard keys on the null → timestamp transition. Ordinary edits and un-archiving must pass,
  // or every rename of a property with units would start failing.
  ok("renaming a property with units still works",
    (await attempt("update app.property set name='اسم جديد' where id=$1", [busyProp])).ok);
  ok("un-archiving a unit works", (await attempt("update app.unit set deleted_at = null where id=$1", [freeUnit])).ok);
  ok("re-archiving an already-archived row is not blocked",
    (await attempt("update app.unit set deleted_at = now(), deleted_reason='again' where id=$1 and deleted_at is not null", [emptyU])).ok);

  console.log("\n— The paths that must NOT be caught —");
  // import_revert walks a batch in creation order, so it reaches a property before its units. If
  // the guard caught it, undoing a bad import would become impossible — the single most likely
  // moment an office needs to undo anything.
  const batch = (await one(
    "insert into app.import_batch(org_id,kind,status,committed_at) values($1,'properties','committed',now()) returning id", [org])).id;
  const revProp = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج مستورد') returning id", [org, selfOwner])).id;
  const revUnit = (await one("insert into app.unit(org_id,property_id,unit_number) values($1,$2,'R1') returning id", [org, revProp])).id;
  await q("insert into app.import_row(org_id,batch_id,row_number,raw,created_entity_type,created_entity_id) values($1,$2,1,'{}'::jsonb,'property',$3)", [org, batch, revProp]);
  await q("insert into app.import_row(org_id,batch_id,row_number,raw,created_entity_type,created_entity_id) values($1,$2,2,'{}'::jsonb,'unit',$3)", [org, batch, revUnit]);

  const revert = await attempt("select app.import_revert($1)", [batch]);
  ok("import_revert undoes a batch parent-first", revert.ok, revert.error);
  ok("…and really archived the property", (await one("select deleted_at from app.property where id=$1", [revProp])).deleted_at !== null);
  ok("…and its unit", (await one("select deleted_at from app.unit where id=$1", [revUnit])).deleted_at !== null);

  // The flag is transaction-local, so it must not still be on afterwards.
  ok("the cascade flag does not survive the call", (await one("select app.archive_cascade_in_progress() v")).v === false);
  ok("and the guard is armed again right after", !(await archive("property", busyProp)).ok);

  // PDPL erasure was the other path that could have been caught. It redacts columns and soft-deletes
  // trade names; it never soft-deletes a tenant, an owner or a property, so it never meets the guard.
  //
  // That is asserted against the function's own body rather than by calling it: erase_party refuses
  // a superuser with FORBIDDEN long before reaching any archive, so a call here would pass without
  // testing anything. This reads the invariant directly — the day erasure starts soft-deleting a
  // party, this line fails and whoever changed it has to come and think about the guard.
  const eraseBody = (await one(
    "select pg_get_functiondef(p.oid) as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app' and p.proname='erase_party'")).src;
  const softDeletes = (table) =>
    new RegExp(`update\\s+app\\.${table}[^;]*set[^;]*deleted_at`, "is").test(eraseBody);
  ok("PDPL erasure never soft-deletes a tenant", !softDeletes("tenant"));
  ok("PDPL erasure never soft-deletes an owner", !softDeletes("owner"));
  ok("PDPL erasure never soft-deletes a property", !softDeletes("property"));
} catch (e) {
  fail++;
  console.log("  FAIL  suite crashed -> " + e.message);
} finally {
  await stop();
}

console.log(`\nArchive guards: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
