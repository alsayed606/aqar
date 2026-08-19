// Portal invitation lifecycle (migration 0075).
//
// Four claims are worth proving, because each of them fails silently:
//   1. only ONE portal invitation is live per profile — resending rotates, it does not accumulate;
//   2. correcting the tenant's email retires the token already in flight to the old address;
//   3. a retired token (superseded / revoked) is refused by acceptance, not merely hidden;
//   4. the office's view of the state never returns the token, and non-admins cannot resend or revoke.
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

const { client, stop } = await bootWithMigrations(54364);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// A PostgREST-shaped session. Committed, because the lifecycle IS the accumulated state.
async function asUser(sub, org, claims, body) {
  await q("begin");
  try {
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated", ...claims })]);
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

try {
  // ---------------- Seed ----------------
  const org = (await one("insert into app.organization(name) values('Invite Office') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  const mkIdentity = async (phone) => (await one(
    "insert into app.identity(phone_e164, phone_raw) values($1,$1) returning id", [phone])).id;
  const admin = await mkIdentity("+966500000101");
  const staff = await mkIdentity("+966500000102");
  const tenantLogin = await mkIdentity("+966500000103");
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [admin, org]);
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'staff','active',true)", [staff, org]);

  const party = (await one(
    `insert into app.party(org_id,display_name,roles,national_id,email)
     values($1,'Tenant Nora',array['tenant']::app.party_role[],'1000000101','nora@example.com') returning id`, [org])).id;
  await q("insert into app.tenant(org_id,party_id) values($1,$2)", [org, party]);

  const stateOf = async (p = party) =>
    (await asUser(admin, org, {}, async () => (await q("select * from app.portal_invitation_state($1)", [p])).rows[0]));

  // ---------------- 1. Nothing yet ----------------
  ok("state is 'none' before any invitation", (await stateOf()).state === "none");

  // ---------------- 2. Create → pending → sent → opened ----------------
  // Seeded directly rather than through app.create_tenant_invitation: that function is SECURITY
  // INVOKER and reaches auth.uid(), which the embedded harness does not expose to `authenticated`.
  // What this suite is about is the lifecycle around the token, not how the first one is minted.
  const token1 = "invite-token-one";
  await q(
    `insert into app.invitation(org_id, party_id, kind, email, token_hash, expires_at)
     values($1,$2,'tenant_portal','nora@example.com', encode(extensions.digest($3,'sha256'),'hex'), now()+interval '30 days')`,
    [org, party, token1]);
  ok("a fresh invitation reads as 'pending'", (await stateOf()).state === "pending");

  const inv1 = (await one("select id from app.invitation where party_id=$1 order by created_at desc limit 1", [party])).id;
  await asUser(admin, org, {}, () => q("select app.mark_invitation_sent($1,'email','nora@example.com')", [inv1]));
  const sent = await stateOf();
  ok("after sending it reads as 'sent'", sent.state === "sent");
  ok("the address it went to is recorded", sent.sent_to === "nora@example.com");
  ok("the channel is recorded", sent.sent_channel === "email");

  await asUser(tenantLogin, null, { email: "nora@example.com" }, () =>
    q("select app.mark_invitation_opened($1)", [token1]));
  ok("opening the link reads as 'opened'", (await stateOf()).state === "opened");

  // The office is told where it stands, never how to impersonate the tenant.
  const cols = Object.keys(await stateOf());
  ok("the state carries no token", !cols.some((c) => /token/i.test(c)));

  // ---------------- 3. Resending rotates ----------------
  const token2 = await asUser(admin, org, {}, async () =>
    (await q("select app.resend_portal_invitation($1) as t", [party])).rows[0].t);
  ok("resending issues a different token", token2 !== token1);
  const live = await one(
    `select count(*)::int as n from app.invitation
     where party_id=$1 and accepted_at is null and revoked_at is null and superseded_at is null`, [party]);
  ok("exactly one invitation stays live after a resend", live.n === 1);
  // The invariant itself, not just the function that respects it: production had reached two live
  // tokens on one profile before 0075, which is what the migration's backfill had to repair.
  await expectThrow("a second live invitation cannot be inserted at all", () =>
    q(`insert into app.invitation(org_id, party_id, kind, email, token_hash, expires_at)
       values($1,$2,'tenant_portal','nora@example.com', encode(extensions.digest('dup','sha256'),'hex'), now()+interval '30 days')`,
      [org, party]), "invitation_one_live_portal");

  await expectThrow("the rotated-out token is refused", () =>
    asUser(tenantLogin, null, { email: "nora@example.com" }, () =>
      q("select app.accept_portal_invitation($1)", [token1])), "INVITATION_INVALID");

  // ---------------- 4. Changing the contact retires the token in flight ----------------
  await q("update app.party set email='nora.q@example.com' where id=$1", [party]);
  ok("correcting the email supersedes the live invitation", (await stateOf()).state === "superseded");
  await expectThrow("a superseded token cannot be accepted", () =>
    asUser(tenantLogin, null, { email: "nora@example.com" }, () =>
      q("select app.accept_portal_invitation($1)", [token2])), "INVITATION_INVALID");
  ok("the profile is still unlinked",
    (await one("select identity_id from app.party where id=$1", [party])).identity_id === null);

  // ---------------- 5. A new invitation to the corrected address works ----------------
  const token3 = await asUser(admin, org, {}, async () =>
    (await q("select app.resend_portal_invitation($1) as t", [party])).rows[0].t);
  await expectThrow("the old address no longer matches", () =>
    asUser(tenantLogin, null, { email: "nora@example.com" }, () =>
      q("select app.accept_portal_invitation($1)", [token3])), "CONTACT_MISMATCH");
  const linked = await asUser(tenantLogin, null, { email: "nora.q@example.com" }, async () =>
    (await q("select app.accept_portal_invitation($1) as p", [token3])).rows[0].p);
  ok("the corrected address links the profile", linked === party);
  ok("the office now reads 'linked'", (await stateOf()).state === "linked");

  // ---------------- 6. Who may do what ----------------
  await expectThrow("a non-admin cannot resend", () =>
    asUser(staff, org, {}, () => q("select app.resend_portal_invitation($1)", [party])), "FORBIDDEN");
  await expectThrow("a non-admin cannot revoke", () =>
    asUser(staff, org, {}, () => q("select app.revoke_portal_invitation($1,'no')", [party])), "FORBIDDEN");
  await expectThrow("a linked profile cannot be re-invited before unlinking", () =>
    asUser(admin, org, {}, () => q("select app.resend_portal_invitation($1)", [party])), "ALREADY_LINKED");

  // ---------------- 7. Revoke ----------------
  await asUser(admin, org, {}, () => q("select app.unlink_party_identity($1,'test')", [party]));
  const token4 = await asUser(admin, org, {}, async () =>
    (await q("select app.resend_portal_invitation($1) as t", [party])).rows[0].t);
  const revoked = await asUser(admin, org, {}, async () =>
    (await q("select app.revoke_portal_invitation($1,'sent to the wrong person') as n", [party])).rows[0].n);
  ok("revoking retires the live invitation", revoked === 1);
  ok("the office reads 'revoked'", (await stateOf()).state === "revoked");
  await expectThrow("a revoked token cannot be accepted", () =>
    asUser(tenantLogin, null, { email: "nora.q@example.com" }, () =>
      q("select app.accept_portal_invitation($1)", [token4])), "INVITATION_INVALID");

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.error("HARNESS ERROR:", e.message, "\n", e);
  fail++;
} finally {
  await stop();
}

process.exit(fail === 0 ? 0 : 1);
