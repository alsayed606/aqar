// Internal notes (migration 0065). See docs/foundation/08-design-system-red-sea-marine.md §6.1.
//
// Most of this file is about the two claims that are easy to make and easy to get wrong:
// "append-only" and "the author is who they say they are".
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54356);
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

// Same session setup as asRole, but the work is kept. Used where a later assertion has to see what
// the statement left behind rather than only whether it was allowed.
async function asRoleCommitted(sub, org, sql, params) {
  await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role: "authenticated" })]);
  if (org) await q("select set_config('request.headers', $1, false)", [JSON.stringify({ "x-active-org": org })]);
  await q("set role authenticated");
  try {
    return { ok: true, rows: (await q(sql, params)).rows };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await q("reset role");
  }
}

try {
  // ---------------- Seed ----------------
  const org = (await one("insert into app.organization(name) values('مكتب الملاحظات') returning id")).id;
  const orgB = (await one("insert into app.organization(name) values('مكتب آخر') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [orgB]);

  const ownerParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'مالك',array['owner']::app.party_role[]) returning id", [org])).id;
  const owner = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id", [org, ownerParty])).id;
  const propA = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج أ') returning id", [org, owner])).id;
  const propB = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'برج ب') returning id", [org, owner])).id;

  const tParty = (await one("insert into app.party(org_id,display_name,roles,national_id) values($1,'مستأجر',array['tenant']::app.party_role[],'1099887766') returning id", [org])).id;
  const tenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, tParty])).id;

  // A tenant belonging to the OTHER office, for the cross-org attachment test.
  const foreignParty = (await one("insert into app.party(org_id,display_name,roles,national_id) values($1,'غريب',array['tenant']::app.party_role[],'1088776655') returning id", [orgB])).id;
  const foreignTenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [orgB, foreignParty])).id;

  const addNote = (target, id, body) =>
    attempt(`insert into app.entity_note(org_id, ${target}, body) values($1,$2,$3) returning id, created_by`,
      [org, id, body]);

  // ==================== The target ====================
  ok("a note can be attached to a tenant", (await addNote("tenant_id", tenant, "اتصلنا به بخصوص التأخير")).ok);
  ok("a note can be attached to an owner", (await addNote("owner_id", owner, "يفضّل التحويل البنكي")).ok);
  ok("a note can be attached to a property", (await addNote("property_id", propA, "بوابة المرآب تحتاج صيانة")).ok);

  const noTarget = await attempt("insert into app.entity_note(org_id, body) values($1,'بلا هدف')", [org]);
  ok("a note attached to nothing is refused",
    !noTarget.ok && /entity_note_one_target/.test(noTarget.error || ""), noTarget.error);

  const twoTargets = await attempt(
    "insert into app.entity_note(org_id, tenant_id, owner_id, body) values($1,$2,$3,'هدفان')", [org, tenant, owner]);
  ok("a note attached to two things at once is refused",
    !twoTargets.ok && /entity_note_one_target/.test(twoTargets.error || ""), twoTargets.error);

  // The composite foreign key is what proves this, not a trigger and not the application.
  const crossOrg = await attempt(
    "insert into app.entity_note(org_id, tenant_id, body) values($1,$2,'عبر المكاتب')", [org, foreignTenant]);
  ok("a note cannot be attached to another office's tenant",
    !crossOrg.ok && /foreign key/i.test(crossOrg.error || ""), crossOrg.error);

  const blank = await attempt("insert into app.entity_note(org_id, tenant_id, body) values($1,$2,'   ')", [org, tenant]);
  ok("a note that is only whitespace is refused", !blank.ok, "insert unexpectedly succeeded");

  // ==================== Append-only ====================
  const idFull = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000901','+966500000901','كامل') returning id")).id;
  const idScoped = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000902','+966500000902','مقيّد') returning id")).id;
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idFull, org]);
  const scopedMembership = (await one(
    "insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'staff','active',false) returning id", [idScoped, org])).id;
  await q("insert into app.membership_property_scope(membership_id,property_id) values($1,$2)", [scopedMembership, propB]);

  const tenantNote = (await one("select id from app.entity_note where tenant_id=$1 limit 1", [tenant])).id;

  // First line of defence: UPDATE and DELETE are simply never granted.
  const edit = await asRole(idFull, org, () =>
    client.query("update app.entity_note set body='تعديل' where id=$1", [tenantNote]));
  ok("a member cannot edit a note", !edit.ok && /permission denied/i.test(edit.error || ""), edit.error);

  const del = await asRole(idFull, org, () =>
    client.query("delete from app.entity_note where id=$1", [tenantNote]));
  ok("a member cannot delete a note", !del.ok && /permission denied/i.test(del.error || ""), del.error);

  // Second line: RLS. There is no UPDATE or DELETE policy, so even with the privilege the statement
  // matches no rows at all — it does not error, it simply does nothing.
  await q("grant update, delete on app.entity_note to authenticated");
  const editGranted = await asRole(idFull, org, () =>
    client.query("update app.entity_note set body='تعديل' where id=$1", [tenantNote]));
  ok("with the privilege granted but no policy, an edit touches no rows",
    editGranted.ok && editGranted.value.rowCount === 0,
    JSON.stringify({ ok: editGranted.ok, rows: editGranted.value?.rowCount, err: editGranted.error }));

  // Third line: the trigger, which is the only one left if BOTH the grant and a policy were ever
  // widened — the compound accident 0053 exists to warn about. Proven rather than assumed.
  await q("create policy tmp_note_update on app.entity_note for update using (true) with check (true)");
  await q("create policy tmp_note_delete on app.entity_note for delete using (true)");
  const editWideOpen = await asRole(idFull, org, () =>
    client.query("update app.entity_note set body='تعديل' where id=$1", [tenantNote]));
  ok("even with grant AND policy, the trigger refuses the edit",
    !editWideOpen.ok && /NOTE_APPEND_ONLY/.test(editWideOpen.error || ""), editWideOpen.error);
  const delWideOpen = await asRole(idFull, org, () =>
    client.query("delete from app.entity_note where id=$1", [tenantNote]));
  ok("and refuses the delete",
    !delWideOpen.ok && /NOTE_APPEND_ONLY/.test(delWideOpen.error || ""), delWideOpen.error);

  await q("drop policy tmp_note_update on app.entity_note");
  await q("drop policy tmp_note_delete on app.entity_note");
  await q("revoke update, delete on app.entity_note from authenticated");

  ok("and the note is still there afterwards",
    Number((await one("select count(*)::int n from app.entity_note where id=$1", [tenantNote])).n) === 1);

  // ==================== Authorship ====================
  const authored = await asRole(idFull, org, () =>
    client.query("insert into app.entity_note(org_id, tenant_id, body, created_by) values($1,$2,'منسوبة',$3) returning created_by",
      [org, tenant, idScoped]));
  ok("the author is taken from the session, not from the request",
    authored.ok && authored.value.rows[0].created_by === idFull,
    JSON.stringify(authored.value?.rows ?? authored.error));

  // ==================== RLS ====================
  const scopedSees = await asRole(idScoped, org, () =>
    client.query("select count(*)::int n from app.entity_note where property_id is not null"));
  ok("a property-scoped member does not see notes on properties outside their scope",
    scopedSees.ok && scopedSees.value.rows[0].n === 0, JSON.stringify(scopedSees.value?.rows));

  const scopedWrite = await asRole(idScoped, org, () =>
    client.query("insert into app.entity_note(org_id, property_id, body) values($1,$2,'محاولة')", [org, propA]));
  ok("nor can they write one there", !scopedWrite.ok, "insert unexpectedly succeeded");

  const scopedOwnProperty = await asRole(idScoped, org, () =>
    client.query("insert into app.entity_note(org_id, property_id, body) values($1,$2,'ضمن نطاقي') returning id", [org, propB]));
  ok("but they can write on the property they are scoped to", scopedOwnProperty.ok, scopedOwnProperty.error);

  const otherOffice = await asRole(idFull, orgB, () =>
    client.query("select count(*)::int n from app.entity_note"));
  ok("notes of another office are invisible", otherOffice.ok && otherOffice.value.rows[0].n === 0, otherOffice.error);

  // ==================== PDPL erasure ====================
  const before = Number((await one(
    "select count(*)::int n from app.entity_note where tenant_id=$1 and redacted_at is null", [tenant])).n);
  ok("the tenant has notes before erasure", before > 0);

  // erase_party checks is_org_admin, so it needs a real session — and unlike asRole this one has to
  // COMMIT, because the assertions below inspect what the erasure actually left behind.
  const erased = await asRoleCommitted(idFull, org,
    "select app.erase_party($1,$2,'طلب صاحب البيانات') as r", [org, tParty]);
  ok("erasing the party succeeds", erased.ok, erased.error);
  ok("erasure reports how many notes it redacted",
    erased.ok && erased.rows[0].r.notes_redacted >= 1, JSON.stringify(erased.rows?.[0]?.r ?? erased.error));

  const redacted = await q(
    "select body, redacted_at, redacted_reason from app.entity_note where tenant_id=$1", [tenant]);
  ok("the note body is gone", redacted.rows.every((r) => !r.body.includes("التأخير")),
    JSON.stringify(redacted.rows));
  ok("but the note row survives so the timeline keeps its shape",
    redacted.rows.length > 0 && redacted.rows.every((r) => r.redacted_at !== null));
  ok("and the reason is recorded", redacted.rows.every((r) => r.redacted_reason === 'طلب صاحب البيانات'));

  // A note on the property is not about the party and must be left alone.
  const untouched = await one("select body from app.entity_note where property_id=$1 limit 1", [propA]);
  ok("a note about a property is NOT redacted by a party erasure",
    untouched.body.includes("المرآب"), untouched.body);

  // ==================== The purge path ====================
  // Deleting an organization cascades into its notes. The append-only trigger must not block the
  // office's own deletion request.
  await q("insert into app.entity_note(org_id, tenant_id, body) values($1,$2,'ملاحظة المكتب الآخر')", [orgB, foreignTenant]);
  await q("begin");
  await q("select set_config('app.allow_org_purge','on',true)");
  const purge = await attempt("delete from app.organization where id=$1", [orgB]);
  await q(purge.ok ? "commit" : "rollback");
  ok("the org-purge path still cascades into its notes", purge.ok, purge.error);
  ok("and the notes are gone with it",
    Number((await one("select count(*)::int n from app.entity_note where org_id=$1", [orgB])).n) === 0);

  console.log(`\nNotes: ${pass} passed, ${fail} failed`);
} catch (e) {
  fail++;
  console.error("FATAL", e);
} finally {
  await stop();
}
process.exitCode = fail === 0 ? 0 : 1;
