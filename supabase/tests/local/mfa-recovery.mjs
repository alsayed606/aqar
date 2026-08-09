// Recovery codes and the e-mail fallback (migration 0070).
//
// 0069 protected the account; this migration is about getting BACK IN, which is where second
// factors are normally broken. So the assertions are the ways a way back in stops being safe:
// a code that works twice, a sheet another account can spend, a weak proof that quietly becomes a
// strong one, printing new keys from a stolen password, and a restricted session that can undo its
// own restriction.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54362);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// A caller is an identity, a session, AND an assurance level — 0070 reads the `aal` claim to know
// whether a TOTP session has stepped up, so the tests have to be able to set it.
async function as(sub, session, sql, params, aal = "aal1") {
  await q("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub, session_id: session, role: "authenticated", aal }),
  ]);
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await q("select set_config('request.jwt.claims','',false)"); }
}
const value = (r) => r.rows?.[0] && Object.values(r.rows[0])[0];

// The app hashes; the tests only need a stable one-way-ish value that differs per code and account.
const H = (code, sub) => `${sub}::rc::${code}`;
const OTP = (code, sub) => `${sub}::${code}`;

try {
  const mkId = async (email) => (await one(
    "insert into app.identity(phone_e164,phone_raw,full_name,email) values($1,$1,'مستخدم',$2) returning id",
    ["+9665" + String(10000000 + Math.floor(Math.random() * 8999999)), email])).id;

  const alice = await mkId("alice@example.com");
  const bob = await mkId("bob@example.com");
  const sessionA = "11111111-1111-1111-1111-111111111111";
  const sessionB = "22222222-2222-2222-2222-222222222222";
  const sessionC = "33333333-3333-3333-3333-333333333333";
  const sheet = ["AAAAA-11111", "BBBBB-22222", "CCCCC-33333"];
  const hashes = sheet.map((c) => H(c, alice));

  // ---------------- Who may print keys ----------------------------------------------------------
  let r = await as(alice, sessionA, "select app.mfa_recovery_generate($1::text[])", [hashes]);
  ok("a password-only session cannot print recovery codes",
     !r.ok && /STEP_UP_REQUIRED/.test(r.error), r.error);

  // An aal2 TOTP session is proof, and it lives in the token rather than in our tables.
  r = await as(alice, sessionA, "select app.mfa_recovery_generate($1::text[]) as n", [hashes], "aal2");
  ok("an aal2 session may print them", r.ok && Number(value(r)) === 3, r.error);

  r = await as(alice, sessionA, "select app.mfa_recovery_generate($1::text[])",
               [[...hashes, hashes[0]]], "aal2");
  ok("a set with a duplicate inside it is refused", !r.ok && /BAD_CODE_SET/.test(r.error), r.error);

  r = await as(alice, sessionA, "select app.mfa_recovery_generate($1::text[])", [[]], "aal2");
  ok("an empty set is refused", !r.ok && /BAD_CODE_SET/.test(r.error), r.error);

  r = await as(alice, sessionA, "select count(*)::int as n from app.mfa_recovery_code where identity_id=$1", [alice]);
  ok("the refused sets left the good one untouched", Number(value(r)) === 3, r.error);

  // ---------------- Spending one -----------------------------------------------------------------
  r = await as(alice, sessionB, "select app.mfa_recovery_consume($1) as v", [H(sheet[0], alice)]);
  ok("a valid code is accepted with no prior proof at all", value(r) === "OK", r.error);

  r = await as(alice, sessionB, "select stepped_up, step_up_method, codes_left from app.mfa_state()");
  ok("it steps the session up", r.ok && r.rows[0].stepped_up === true, r.error);
  ok("with FULL standing, not the restricted kind", r.ok && r.rows[0].step_up_method === "recovery_code", JSON.stringify(r.rows?.[0]));
  ok("and the remaining count drops", r.ok && r.rows[0].codes_left === 2, JSON.stringify(r.rows?.[0]));

  r = await as(alice, sessionC, "select app.mfa_recovery_consume($1) as v", [H(sheet[0], alice)]);
  ok("the same code cannot be spent twice", value(r) === "BAD_CODE", r.error);

  r = await as(bob, sessionA, "select app.mfa_recovery_consume($1) as v", [H(sheet[1], alice)]);
  ok("another account cannot spend Alice's sheet", value(r) === "BAD_CODE", r.error);

  r = await as(bob, sessionA, "select stepped_up from app.mfa_state()");
  ok("and that refusal stepped nobody up", r.ok && r.rows[0].stepped_up === false, r.error);

  // A wrong code is indistinguishable from a spent one — the verdict must not confirm a guess.
  r = await as(alice, sessionC, "select app.mfa_recovery_consume('nonsense') as v");
  ok("a wrong code returns the same verdict as a spent one", value(r) === "BAD_CODE", r.error);

  // ---------------- The e-mail fallback is WEAKER, and stays weaker -------------------------------
  const sessionD = "44444444-4444-4444-4444-444444444444";
  r = await as(alice, sessionD, "select app.mfa_challenge_issue($1,'recovery',600)", [OTP("111111", alice)]);
  ok("a 'recovery' challenge may be issued", r.ok, r.error);

  r = await as(alice, sessionD, "select app.mfa_challenge_verify($1,'recovery') as v", [OTP("111111", alice)]);
  ok("the mailed recovery code verifies", value(r) === "OK", r.error);

  r = await as(alice, sessionD, "select step_up_method from app.mfa_state()");
  ok("it grants the RESTRICTED method, never full standing",
     r.ok && r.rows[0].step_up_method === "email_fallback", JSON.stringify(r.rows?.[0]));

  r = await as(alice, sessionD, "select app.mfa_recovery_generate($1::text[])", [hashes]);
  ok("a restricted session cannot print itself a new set of keys",
     !r.ok && /STEP_UP_REQUIRED/.test(r.error), r.error);

  // A step-up code and a recovery code are different purposes and must not substitute.
  const sessionE = "55555555-5555-5555-5555-555555555555";
  await as(alice, sessionE, "select app.mfa_challenge_issue($1,'step_up',600)", [OTP("222222", alice)]);
  r = await as(alice, sessionE, "select app.mfa_challenge_verify($1,'recovery') as v", [OTP("222222", alice)]);
  ok("a step_up code cannot be redeemed as a recovery code", value(r) === "NO_CHALLENGE", r.error);

  // ---------------- Promotion goes one way only ---------------------------------------------------
  await as(alice, sessionD, "select app.mfa_enroll_start('email','alice@example.com')");
  await as(alice, sessionD, "select app.mfa_challenge_issue($1,'enroll',600)", [OTP("333333", alice)]);
  r = await as(alice, sessionD, "select app.mfa_challenge_verify($1,'enroll') as v", [OTP("333333", alice)]);
  ok("proving the real factor from a restricted session works", value(r) === "OK", r.error);
  r = await as(alice, sessionD, "select step_up_method from app.mfa_state()");
  ok("and PROMOTES it to full standing", r.ok && r.rows[0].step_up_method === "factor", JSON.stringify(r.rows?.[0]));

  await as(alice, sessionD, "select app.mfa_challenge_issue($1,'recovery',600)", [OTP("444444", alice)]);
  r = await as(alice, sessionD, "select app.mfa_challenge_verify($1,'recovery') as v", [OTP("444444", alice)]);
  ok("a later recovery mail still verifies", value(r) === "OK", r.error);
  r = await as(alice, sessionD, "select step_up_method from app.mfa_state()");
  ok("but CANNOT demote a session that already proved the factor",
     r.ok && r.rows[0].step_up_method === "factor", JSON.stringify(r.rows?.[0]));

  // ---------------- Ending the restricted session --------------------------------------------------
  const sessionF = "66666666-6666-6666-6666-666666666666";
  await as(alice, sessionF, "select app.mfa_challenge_issue($1,'recovery',600)", [OTP("555555", alice)]);
  await as(alice, sessionF, "select app.mfa_challenge_verify($1,'recovery')", [OTP("555555", alice)]);
  r = await as(alice, sessionF, "select app.mfa_recovery_finish()");
  ok("a restricted session can end its own restriction", r.ok, r.error);
  r = await as(alice, sessionF, "select stepped_up from app.mfa_state()");
  ok("which leaves it with no step-up at all — not with free passage",
     r.ok && r.rows[0].stepped_up === false, JSON.stringify(r.rows?.[0]));

  r = await as(alice, sessionD, "select app.mfa_recovery_finish()");
  ok("but a full session cannot delete its own step-up record", r.ok, r.error);
  r = await as(alice, sessionD, "select stepped_up, step_up_method from app.mfa_state()");
  ok("— the row survives", r.ok && r.rows[0].stepped_up === true && r.rows[0].step_up_method === "factor",
     JSON.stringify(r.rows?.[0]));

  // ---------------- Disabling takes the codes with it -----------------------------------------------
  r = await as(alice, sessionD, "select app.mfa_disable()");
  ok("disable accepted from a proved session", r.ok, r.error);
  r = await as(alice, sessionD, "select count(*)::int as n from app.mfa_recovery_code where identity_id=$1", [alice]);
  ok("codes do not outlive the factor they were printed for", Number(value(r)) === 0, r.error);

  // ---------------- The table is unreachable directly ------------------------------------------------
  const row = await one(
    "select relrowsecurity as rls, (select count(*) from pg_policies where schemaname='app' and tablename='mfa_recovery_code') as policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relname='mfa_recovery_code'");
  ok("app.mfa_recovery_code: RLS on with no policy", row.rls === true && Number(row.policies) === 0, JSON.stringify(row));

  const provedGrant = await one(
    "select has_function_privilege('authenticated', p.oid, 'execute') as g from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='mfa_proved'");
  ok("mfa_proved is not app-facing", provedGrant.g === false, JSON.stringify(provedGrant));

  const ledger = await one("select verified from app.schema_migration where version='0070'");
  ok("0070 recorded itself in the ledger", ledger !== undefined, JSON.stringify(ledger));
} finally {
  await stop();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
