// The management fee moves as one thing (migration 0083).
//
// It used to be two statements in the application with nothing between them: retire the live
// percentage agreement, then insert the new one. The retire was never even checked — an RLS refusal
// matches zero rows and raises nothing — so a member who could insert but not retire left the owner
// with TWO live fee agreements, and nothing said which one the statement should read.
//
// This is the office's commission, so the claims worth proving are about what survives a refusal.
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

const { client, stop } = await bootWithMigrations(54366);
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

const liveFees = (owner) =>
  q(`select id, fee_percentage from app.management_agreement
      where owner_id = $1 and fee_model = 'percentage_of_collection' and deleted_at is null`, [owner]);

try {
  const org = (await one("insert into app.organization(name) values('Fee Office') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  const admin = (await one(
    "insert into app.identity(phone_e164, phone_raw) values('+966500000401','+966500000401') returning id")).id;
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)",
    [admin, org]);

  const party = (await one(
    `insert into app.party(org_id,display_name,roles,national_id)
     values($1,'Owner Nasser',array['owner']::app.party_role[],'1000000401') returning id`, [org])).id;
  const owner = (await one(
    "insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id", [org, party])).id;

  // ---------------- 1. The ordinary path ----------------
  const first = await asUser(admin, org, () => one("select app.set_owner_fee($1, 0.0500) as id", [owner]));
  let live = await liveFees(owner);
  ok("setting a fee leaves exactly one live agreement", live.rows.length === 1);
  ok("and it carries the percentage given", Number(live.rows[0].fee_percentage) === 0.05);
  ok("and it returns the row it created", live.rows[0].id === first.id);

  const second = await asUser(admin, org, () => one("select app.set_owner_fee($1, 0.0750) as id", [owner]));
  live = await liveFees(owner);
  ok("changing it still leaves exactly one live agreement", live.rows.length === 1, `saw ${live.rows.length}`);
  ok("and it is the new one", live.rows[0].id === second.id && Number(live.rows[0].fee_percentage) === 0.075);
  ok("and the old one is retired, not deleted",
    (await one(`select count(*)::int n from app.management_agreement
                 where owner_id=$1 and deleted_at is not null and deleted_reason='fee_update'`, [owner])).n === 1);

  // ---------------- 2. The boundaries ----------------
  // 0 and 100 are both real arrangements — free management, and a head-lease that takes everything.
  await asUser(admin, org, () => q("select app.set_owner_fee($1, 0)", [owner]));
  ok("zero is a fee, not an error", Number((await liveFees(owner)).rows[0].fee_percentage) === 0);
  await asUser(admin, org, () => q("select app.set_owner_fee($1, 1)", [owner]));
  ok("one hundred percent is a fee too", Number((await liveFees(owner)).rows[0].fee_percentage) === 1);

  await expectThrow("above one hundred is refused",
    () => asUser(admin, org, () => q("select app.set_owner_fee($1, 1.5)", [owner])), "INVALID_PERCENTAGE");
  await expectThrow("below zero is refused",
    () => asUser(admin, org, () => q("select app.set_owner_fee($1, -0.1)", [owner])), "INVALID_PERCENTAGE");
  await expectThrow("null is refused",
    () => asUser(admin, org, () => q("select app.set_owner_fee($1, null)", [owner])), "INVALID_PERCENTAGE");
  await expectThrow("an unknown owner is refused",
    () => asUser(admin, org, () => q("select app.set_owner_fee(gen_random_uuid(), 0.05)")), "OWNER_NOT_FOUND");

  ok("a refused call changes nothing", (await liveFees(owner)).rows.length === 1);

  // ---------------- 3. The refusal this migration exists for ----------------
  // A member of another org can neither retire nor insert here. What matters is not that it fails —
  // it is that it fails WHOLE: no second live agreement is left behind by the half that succeeded.
  const outsiderOrg = (await one("insert into app.organization(name) values('Other Office') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [outsiderOrg]);
  const outsider = (await one(
    "insert into app.identity(phone_e164, phone_raw) values('+966500000402','+966500000402') returning id")).id;
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)",
    [outsider, outsiderOrg]);

  const before = (await liveFees(owner)).rows[0].id;
  await expectThrow(
    "an outsider cannot reprice another office's owner",
    () => asUser(outsider, outsiderOrg, () => q("select app.set_owner_fee($1, 0.99)", [owner])),
    undefined,
  );
  const after = await liveFees(owner);
  ok("and the owner is left with exactly one live agreement — the original",
    after.rows.length === 1 && after.rows[0].id === before, `saw ${after.rows.length}`);
} catch (e) {
  fail++;
  console.log("  FAIL  suite aborted -> " + (e?.message ?? e));
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await stop();
  process.exit(fail ? 1 : 0);
}
