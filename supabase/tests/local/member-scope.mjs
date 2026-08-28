// A member's property scope moves as one thing (migration 0084).
//
// It used to be three writes from the application with nothing holding them together: set the flag,
// delete every scope row, insert the chosen ones. Stopping after the second left the member scoped
// to NOTHING — an empty portfolio — while the admin read an error and concluded nothing had changed.
//
// The claims worth proving are about what survives a refusal, and about the guard the old code could
// not have: the scope policy proves the MEMBERSHIP belongs to an org the caller administers, and
// says nothing at all about the properties being granted.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};
async function expectThrow(name, fn, needle) {
  try { await fn(); fail++; console.log("  FAIL  " + name + "  -> expected error, none thrown"); }
  catch (e) {
    const good = !needle || (e.message && e.message.includes(needle));
    if (good) { pass++; console.log("  PASS  " + name); }
    else { fail++; console.log("  FAIL  " + name + "  -> got: " + e.message); }
  }
}

const { client, stop } = await bootWithMigrations(54367);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

async function asUser(sub, org, body) {
  await q("begin");
  try {
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
    if (org) await q("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-active-org": org })]);
    await q("set local role authenticated");
    const value = await body();
    await q("reset role");
    await q("commit");
    return value;
  } catch (e) {
    await q("rollback").catch(() => {});
    throw e;
  }
}

const scopeOf = async (membership) => ({
  all: (await one("select scope_all from app.membership where id=$1", [membership])).scope_all,
  properties: (await q(
    "select property_id from app.membership_property_scope where membership_id=$1 order by property_id",
    [membership])).rows.map((r) => r.property_id),
});

try {
  const org = (await one("insert into app.organization(name) values('Scope Office') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  const mkId = async (phone) => (await one(
    "insert into app.identity(phone_e164, phone_raw) values($1,$1) returning id", [phone])).id;
  const admin = await mkId("+966500000501");
  const staff = await mkId("+966500000502");
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)",
    [admin, org]);
  const staffMembership = (await one(
    `insert into app.membership(identity_id,org_id,role,status,scope_all)
     values($1,$2,'staff','active',true) returning id`, [staff, org])).id;

  const ownerParty = (await one(
    `insert into app.party(org_id,display_name,roles,national_id)
     values($1,'Owner Saad',array['owner']::app.party_role[],'1000000501') returning id`, [org])).id;
  const owner = (await one(
    "insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id", [org, ownerParty])).id;
  const propA = (await one(
    "insert into app.property(org_id,owner_id,name) values($1,$2,'برج أ') returning id", [org, owner])).id;
  const propB = (await one(
    "insert into app.property(org_id,owner_id,name) values($1,$2,'برج ب') returning id", [org, owner])).id;

  // ---------------- 1. Narrowing, and widening again ----------------
  await asUser(admin, org, () =>
    q("select app.set_member_scope($1,false,$2::uuid[])", [staffMembership, [propA]]));
  let scope = await scopeOf(staffMembership);
  ok("scoping a member sets the flag and the rows together",
    scope.all === false && scope.properties.length === 1 && scope.properties[0] === propA);

  await asUser(admin, org, () =>
    q("select app.set_member_scope($1,false,$2::uuid[])", [staffMembership, [propA, propB]]));
  scope = await scopeOf(staffMembership);
  ok("re-scoping replaces the set rather than adding to it", scope.properties.length === 2);

  await asUser(admin, org, () => q("select app.set_member_scope($1,true,'{}'::uuid[])", [staffMembership]));
  scope = await scopeOf(staffMembership);
  // scope_all = true makes the rows meaningless; leaving them would be a second answer to a question
  // the flag already settles.
  ok("reopening everything clears the rows too", scope.all === true && scope.properties.length === 0);

  // ---------------- 2. Refusals leave nothing half-done ----------------
  await asUser(admin, org, () =>
    q("select app.set_member_scope($1,false,$2::uuid[])", [staffMembership, [propA]]));
  const before = await scopeOf(staffMembership);

  const outsiderOrg = (await one("insert into app.organization(name) values('Other Office') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [outsiderOrg]);
  const outsider = await mkId("+966500000503");
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)",
    [outsider, outsiderOrg]);

  await expectThrow(
    "an outsider cannot re-scope another office's member",
    () => asUser(outsider, outsiderOrg, () =>
      q("select app.set_member_scope($1,true,'{}'::uuid[])", [staffMembership])),
    undefined,
  );
  let after = await scopeOf(staffMembership);
  ok("and the member keeps exactly the scope they had",
    after.all === before.all && after.properties.length === 1 && after.properties[0] === propA);

  // The guard the old three-write version could not have had: membership_scope_write proves the
  // MEMBERSHIP is in an org the caller administers, and nothing about the properties.
  const otherOwnerParty = (await one(
    `insert into app.party(org_id,display_name,roles,national_id)
     values($1,'Owner Faris',array['owner']::app.party_role[],'1000000502') returning id`, [outsiderOrg])).id;
  const otherOwner = (await one(
    "insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id",
    [outsiderOrg, otherOwnerParty])).id;
  const foreignProp = (await one(
    "insert into app.property(org_id,owner_id,name) values($1,$2,'برج غريب') returning id",
    [outsiderOrg, otherOwner])).id;

  await expectThrow(
    "a property from another office cannot be granted",
    () => asUser(admin, org, () =>
      q("select app.set_member_scope($1,false,$2::uuid[])", [staffMembership, [propB, foreignProp]])),
    "PROPERTY_NOT_IN_ORG",
  );
  after = await scopeOf(staffMembership);
  ok("and that refusal did not apply the legitimate half either",
    after.properties.length === 1 && after.properties[0] === propA, JSON.stringify(after.properties));

  await expectThrow("an unknown membership is refused",
    () => asUser(admin, org, () => q("select app.set_member_scope(gen_random_uuid(),true,'{}'::uuid[])")),
    "MEMBERSHIP_NOT_FOUND");
} catch (e) {
  fail++;
  console.log("  FAIL  suite aborted -> " + (e?.message ?? e));
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await stop();
  process.exit(fail ? 1 : 0);
}
