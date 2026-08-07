// E-mail second factor (migration 0069).
//
// The interesting assertions are not "a correct code works" — they are the ways a second factor
// stops being one: a code that opens a different session, a factor another account can enable, a
// "resend" that leaves the old code alive, guessing that never runs out, and a disable button that
// works without proving anything.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54361);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// A caller is an identity AND a session: the whole point of the design is that the pair matters.
async function as(sub, session, sql, params) {
  await q("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub, session_id: session, role: "authenticated" }),
  ]);
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await q("select set_config('request.jwt.claims','',false)"); }
}
const value = (r) => r.rows?.[0] && Object.values(r.rows[0])[0];

// The app hashes the code; these tests only need SOME stable one-way value, and any two distinct
// codes must give distinct hashes.
const H = (code, sub) => `${sub}::${code}`;

try {
  const mkId = async (email) => (await one(
    "insert into app.identity(phone_e164,phone_raw,full_name,email) values($1,$1,'مستخدم',$2) returning id",
    ["+9665" + String(10000000 + Math.floor(Math.random() * 8999999)), email])).id;

  const alice = await mkId("alice@example.com");
  const bob = await mkId("bob@example.com");
  const sessionA = "11111111-1111-1111-1111-111111111111";
  const sessionB = "22222222-2222-2222-2222-222222222222";

  // ---------------- Enrolment ------------------------------------------------------------------
  let r = await as(alice, sessionA, "select enabled, stepped_up from app.mfa_state()");
  ok("mfa_state on a fresh account reports no factor", r.ok && r.rows[0].enabled === false && r.rows[0].stepped_up === false, r.error);

  r = await as(alice, sessionA, "select app.mfa_enroll_start('email','Alice@Example.com')");
  ok("enrol accepted", r.ok, r.error);

  r = await as(alice, sessionA, "select destination, verified_at is null as unverified from app.mfa_factor where identity_id=$1", [alice]);
  ok("destination stored lower-cased", r.ok && r.rows[0].destination === "alice@example.com", r.error);
  ok("factor starts UNVERIFIED", r.ok && r.rows[0].unverified === true, r.error);

  r = await as(alice, sessionA, "select enabled from app.mfa_state()");
  ok("an unverified factor does NOT count as enabled", r.ok && r.rows[0].enabled === false, r.error);

  r = await as(alice, sessionA, "select app.mfa_enroll_start('sms','+966500000001')");
  ok("sms is refused until there is a sender", !r.ok && /CHANNEL_UNAVAILABLE/.test(r.error), r.error);

  // ---------------- Verify ---------------------------------------------------------------------
  await as(alice, sessionA, "select app.mfa_challenge_issue($1,'enroll',600)", [H("111111", alice)]);
  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'enroll')", [H("999999", alice)]);
  ok("a wrong code is refused", value(r) === "BAD_CODE", JSON.stringify(r));

  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'enroll')", [H("111111", alice)]);
  ok("the right code verifies", value(r) === "OK", JSON.stringify(r));

  r = await as(alice, sessionA, "select enabled, stepped_up, destination from app.mfa_state()");
  ok("factor is now enabled", r.ok && r.rows[0].enabled === true, r.error);
  ok("verifying at enrolment also steps this session up", r.ok && r.rows[0].stepped_up === true, r.error);

  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'enroll')", [H("111111", alice)]);
  ok("a used code cannot be used twice", value(r) === "NO_CHALLENGE", JSON.stringify(r));

  // ---------------- The session boundary --------------------------------------------------------
  r = await as(alice, sessionB, "select stepped_up from app.mfa_state()");
  ok("a DIFFERENT session of the same person is NOT stepped up", r.ok && r.rows[0].stepped_up === false, r.error);

  await as(alice, sessionA, "select app.mfa_challenge_issue($1,'step_up',600)", [H("222222", alice)]);
  r = await as(alice, sessionB, "select app.mfa_challenge_verify($1,'step_up')", [H("222222", alice)]);
  ok("a code issued to session A does not open session B", value(r) === "NO_CHALLENGE", JSON.stringify(r));

  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'step_up')", [H("222222", alice)]);
  ok("…and still opens the session it was issued to", value(r) === "OK", JSON.stringify(r));

  // ---------------- The account boundary --------------------------------------------------------
  r = await as(bob, sessionB, "select enabled from app.mfa_state()");
  ok("mfa_state answers only about the caller", r.ok && r.rows[0].enabled === false, r.error);

  r = await as(bob, sessionB, "select app.mfa_enroll_start('email','attacker@example.com')");
  r = await as(alice, sessionA, "select destination from app.mfa_factor where identity_id=$1", [alice]);
  ok("bob's enrolment did not touch alice's destination", r.ok && r.rows[0].destination === "alice@example.com", r.error);

  // ---------------- Resend retires the old code -------------------------------------------------
  await as(alice, sessionA, "select app.mfa_challenge_issue($1,'step_up',600)", [H("333333", alice)]);
  await as(alice, sessionA, "select app.mfa_challenge_issue($1,'step_up',600)", [H("444444", alice)]);
  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'step_up')", [H("333333", alice)]);
  ok("resending KILLS the previous code", value(r) === "BAD_CODE", JSON.stringify(r));
  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'step_up')", [H("444444", alice)]);
  ok("…and the newest code is the one that works", value(r) === "OK", JSON.stringify(r));

  // ---------------- Expiry ----------------------------------------------------------------------
  await as(alice, sessionA, "select app.mfa_challenge_issue($1,'step_up',600)", [H("555555", alice)]);
  await q("update app.mfa_challenge set expires_at = now() - interval '1 minute' where consumed_at is null");
  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'step_up')", [H("555555", alice)]);
  ok("an expired code is refused as expired, not as wrong", value(r) === "EXPIRED", JSON.stringify(r));

  // ---------------- Guessing runs out -----------------------------------------------------------
  await as(alice, sessionA, "select app.mfa_challenge_issue($1,'step_up',600)", [H("666666", alice)]);
  const verdicts = [];
  for (let i = 0; i < 6; i++) {
    const bad = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'step_up')", [H("000000", alice)]);
    verdicts.push(value(bad));
  }
  ok("the sixth guess is cut off, not merely wrong", verdicts[5] === "TOO_MANY_ATTEMPTS", verdicts.join(","));
  r = await as(alice, sessionA, "select app.mfa_challenge_verify($1,'step_up')", [H("666666", alice)]);
  ok("and the correct code is dead too once attempts ran out", value(r) === "NO_CHALLENGE", JSON.stringify(r));

  // ---------------- Disabling needs proof --------------------------------------------------------
  r = await as(alice, sessionB, "select app.mfa_disable()");
  ok("a session that never proved the factor cannot remove it", !r.ok && /STEP_UP_REQUIRED/.test(r.error), r.error);

  r = await as(alice, sessionA, "select app.mfa_disable()");
  ok("a stepped-up session can", r.ok, r.error);
  r = await as(alice, sessionA, "select enabled from app.mfa_state()");
  ok("…and the factor is gone", r.ok && r.rows[0].enabled === false, r.error);

  // ---------------- No session, no challenge -----------------------------------------------------
  await as(alice, sessionA, "select app.mfa_enroll_start('email','alice@example.com')");
  await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: alice, role: "authenticated" })]);
  const noSession = await q("select app.mfa_challenge_issue($1,'enroll',600)", [H("777777", alice)])
    .then(() => null).catch((e) => e.message);
  await q("select set_config('request.jwt.claims','',false)");
  ok("a token without session_id cannot get a code at all", /NO_SESSION/.test(noSession ?? ""), String(noSession));

  // ---------------- Grants (the 0053 rule) -------------------------------------------------------
  const grantable = ["mfa_state", "mfa_enroll_start", "mfa_challenge_issue", "mfa_challenge_verify", "mfa_disable"];
  for (const fn of grantable) {
    const anon = await one(
      "select has_function_privilege('anon', p.oid, 'execute') as g from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname=$1",
      [fn]);
    ok(`anon cannot execute app.${fn}`, anon.g === false);
  }
  const sweepAuth = await one(
    "select has_function_privilege('authenticated', p.oid, 'execute') as g from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='mfa_sweep'");
  ok("mfa_sweep is service_role only", sweepAuth.g === false);

  // ---------------- The tables are unreachable directly ------------------------------------------
  for (const t of ["mfa_factor", "mfa_challenge", "mfa_step_up"]) {
    const row = await one(
      "select relrowsecurity as rls, (select count(*) from pg_policies where schemaname='app' and tablename=$1) as policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relname=$1",
      [t]);
    ok(`app.${t}: RLS on with no policy`, row.rls === true && Number(row.policies) === 0, JSON.stringify(row));
  }

  // ---------------- Housekeeping -----------------------------------------------------------------
  await q("update app.mfa_challenge set created_at = now() - interval '2 days'");
  await q("insert into app.mfa_step_up(session_id,identity_id,verified_at) values(gen_random_uuid(),$1, now() - interval '60 days')", [alice]);
  const deleted = await one("select app.mfa_sweep() as n");
  ok("sweep drops day-old challenges", Number(deleted.n) > 0, JSON.stringify(deleted));
  const remaining = await one("select count(*)::int as n from app.mfa_step_up where verified_at < now() - interval '30 days'");
  ok("sweep drops step-ups older than any session can be", remaining.n === 0, JSON.stringify(remaining));

  // ---------------- The ledger --------------------------------------------------------------------
  const ledger = await one("select verified from app.schema_migration where version='0069'");
  ok("0069 recorded itself in the ledger", ledger !== undefined, JSON.stringify(ledger));
} finally {
  await stop();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
