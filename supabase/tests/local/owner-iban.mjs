// The owner's payout account is normalised and checked (migration 0086).
//
// app.organization.iban has been format-checked since 0066; app.owner.iban never was — and that is
// the one money is actually sent to. The widest way in is the Excel importer, which writes the
// column straight from a spreadsheet, so the guard is a trigger plus a constraint on the table
// rather than a validation in one caller.
//
// Two things are worth proving separately: that a correctly-written IBAN with the spaces a human
// puts in it is ACCEPTED (a constraint that rejects correct data has failed, not the user), and
// that a malformed one is refused no matter which door it came through.
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

const { client, stop } = await bootWithMigrations(54368);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const GOOD = "SA0380000000608010167519";

try {
  const org = (await one("insert into app.organization(name) values('IBAN Office') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  let seq = 0;
  const mkOwner = async (iban) => {
    seq += 1;
    const party = (await one(
      `insert into app.party(org_id,display_name,roles,national_id)
       values($1,$2,array['owner']::app.party_role[],$3) returning id`,
      [org, `Owner ${seq}`, String(1000000600 + seq)])).id;
    return (await one(
      "insert into app.owner(org_id,party_id,is_self,iban) values($1,$2,false,$3) returning id, iban",
      [org, party, iban]));
  };

  // ---------------- 1. What a person actually types ----------------
  const spaced = await mkOwner("sa03 8000 0000 6080 1016 7519");
  ok("spaces and lower case are normalised on write, not rejected", spaced.iban === GOOD, spaced.iban);

  const clean = await mkOwner(GOOD);
  ok("an already-clean IBAN is stored unchanged", clean.iban === GOOD);

  const none = await mkOwner(null);
  ok("no account is still allowed", none.iban === null);

  // An emptied field is "no account", not an empty string waiting to fail the format check.
  const blanked = await mkOwner("   ");
  ok("whitespace only becomes null rather than an empty string", blanked.iban === null, String(blanked.iban));

  // ---------------- 2. What must never be stored ----------------
  await expectThrow("too few digits is refused", () => mkOwner("SA0380000000608010167"), "owner_iban_chk");
  await expectThrow("too many digits is refused", () => mkOwner(GOOD + "9"), "owner_iban_chk");
  await expectThrow("another country's IBAN is refused", () => mkOwner("AE070331234567890123456"),
    "owner_iban_chk");
  await expectThrow("letters in the number are refused", () => mkOwner("SA03800000006080101675XY"),
    "owner_iban_chk");

  // The importer needs no case of its own: it reaches app.owner with a plain INSERT, which is what
  // section 1 already exercises. A test that re-enacts a caller's SQL proves the re-enactment.

  // ---------------- 3. Editing keeps the rule ----------------
  await expectThrow(
    "an owner cannot be updated to a malformed IBAN",
    () => q("update app.owner set iban = 'SA1' where id = $1", [clean.id]),
    "owner_iban_chk",
  );
  ok("and the stored value is untouched by the refusal",
    (await one("select iban from app.owner where id=$1", [clean.id])).iban === GOOD);

  await q("update app.owner set iban = 'sa03 8000 0000 6080 1016 7519' where id = $1", [clean.id]);
  ok("an edit is normalised the same way an insert is",
    (await one("select iban from app.owner where id=$1", [clean.id])).iban === GOOD);

  // ---------------- 4. The property the migration's whole risk profile rests on ----------------
  // NOT VALID is why 0086 applies to a live database at all: it does not scan what is already there,
  // so one owner recorded years ago with a wrong number cannot stop the migration. The harness
  // reaches this table empty and can never demonstrate that by inserting — but the flag that grants
  // it is readable, and it is the thing that would be silently wrong if the `not valid` were ever
  // dropped from the ALTER during an edit.
  const constraint = await one(
    `select convalidated from pg_constraint where conname = 'owner_iban_chk'`);
  ok("the check exists", constraint !== undefined);
  ok("and it is NOT VALID, so existing rows were never scanned",
    constraint?.convalidated === false, String(constraint?.convalidated));
} catch (e) {
  fail++;
  console.log("  FAIL  suite aborted -> " + (e?.message ?? e));
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await stop();
  process.exit(fail ? 1 : 0);
}
