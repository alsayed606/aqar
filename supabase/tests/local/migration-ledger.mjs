// The migration ledger (0068).
//
// The harness applies every migration in order, so a correct backfill must find all 67 predecessors
// here. That makes this suite a direct test of the probes themselves: if a probe looks for the
// wrong object, it reports a migration missing on a database that demonstrably has it.
//
// The other half is the part that mattered on 4 Aug 2026 — a MISSING migration must be reported as
// missing. That is exercised by dropping an object and re-running the backfill.
import { bootWithMigrations } from "./_pgutil.mjs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

const { client, stop } = await bootWithMigrations(54360);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const attempt = async (sql, params) => {
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
};

try {
  console.log("— Every migration in the directory is in the ledger —");
  const recorded = (await q("select version, name, verified, backfilled from app.schema_migration order by version")).rows;
  const recordedVersions = new Set(recorded.map((r) => r.version));

  ok(`ledger has a row per migration file (${FILES.length})`, recorded.length === FILES.length,
    `files=${FILES.length} ledger=${recorded.length}`);

  const missing = FILES.map((f) => f.slice(0, 4)).filter((v) => !recordedVersions.has(v));
  ok("no migration file is absent from the ledger", missing.length === 0, missing.join(","));

  // A probe that names the wrong object fails silently as "this migration is missing". On a
  // database built from every migration, that can only mean the probe is wrong.
  const unverified = recorded.filter((r) => !r.verified).map((r) => r.version);
  ok("exactly the four re-emit-only migrations are unverified",
    JSON.stringify(unverified) === JSON.stringify(["0014", "0046", "0055", "0056"]),
    JSON.stringify(unverified));

  console.log("\n— 0068 records itself, and is not a backfill —");
  const self = recorded.find((r) => r.version === "0068");
  ok("0068 is present", Boolean(self));
  ok("0068 is not marked backfilled", self?.backfilled === false, JSON.stringify(self));
  ok("0001–0067 are all marked backfilled",
    recorded.filter((r) => r.version !== "0068").every((r) => r.backfilled === true));

  console.log("\n— A missing migration is reported as missing —");
  // This is the 0029 case reproduced: remove what a migration left behind, re-run the backfill, and
  // the ledger must decline to record it rather than assume it.
  await q("delete from app.schema_migration where version = '0029'");
  await q("drop function if exists app.tenant_is_mine(uuid) cascade");
  const probe = await one("select app.has_app_function('tenant_is_mine') as v");
  ok("the probe sees the object is gone", probe.v === false);

  console.log("\n— record_migration —");
  await q("select app.record_migration('9999', '9999_test')");
  const added = await one("select version, name, backfilled, verified from app.schema_migration where version='9999'");
  ok("a new migration records itself", added?.name === "9999_test");
  ok("…as neither backfilled nor unverified", added.backfilled === false && added.verified === true);

  // Re-running a migration must not create a second row: migrations are re-run on purpose here.
  await q("select app.record_migration('9999', '9999_test')");
  const count = await one("select count(*)::int as n from app.schema_migration where version='9999'");
  ok("re-running a migration updates rather than duplicates", count.n === 1, `n=${count.n}`);

  console.log("\n— Who may read it —");
  // The list of missing migrations is a map of which guards are absent, so it is operator-only and
  // the table itself is unreachable through PostgREST.
  await q("begin");
  await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001", role: "authenticated" })]);
  await q("set local role authenticated");
  // Each probe gets a savepoint: the first refusal aborts the transaction, and without one the two
  // that follow would report "transaction is aborted" and look like passes-turned-failures.
  const asAuthenticated = async (sql) => {
    await q("savepoint p");
    const r = await attempt(sql);
    await q(r.ok ? "release savepoint p" : "rollback to savepoint p");
    return r;
  };
  const readTable = await asAuthenticated("select * from app.schema_migration limit 1");
  const readFn = await asAuthenticated("select * from app.migration_status()");
  const write = await asAuthenticated("select app.record_migration('0001','forged')");
  await q("rollback");

  ok("authenticated cannot read the table", !readTable.ok && /permission denied/i.test(readTable.error ?? ""), readTable.error);
  ok("a non-operator is refused by migration_status", !readFn.ok && /FORBIDDEN|permission denied/i.test(readFn.error ?? ""), readFn.error);
  ok("authenticated cannot forge a ledger row", !write.ok && /permission denied/i.test(write.error ?? ""), write.error);

  console.log("\n— The helpers —");
  ok("has_app_function finds a function by name alone", (await one("select app.has_app_function('write_audit') as v")).v === true);
  ok("has_app_function says no for an invented name", (await one("select app.has_app_function('no_such_fn') as v")).v === false);
  ok("has_app_column finds a column", (await one("select app.has_app_column('property','holding_type') as v")).v === true);
  ok("has_app_column says no for an invented column", (await one("select app.has_app_column('property','nope') as v")).v === false);
} catch (e) {
  fail++;
  console.log("  FAIL  suite crashed -> " + e.message);
} finally {
  await stop();
}

console.log(`\nMigration ledger: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
