// Age limit inside the e-mail queue (migration 0070).
//
// The case this exists for is not "a stale row is skipped" — it is the shape of the 8 Aug 2026
// incident: a queue that has been stopped for months comes back, and must not mail a customer the
// past. So the assertions are about the boundary: what still goes, what is retired, and whether the
// queue depth afterwards means anything.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54362);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

try {
  const org = (await one("insert into app.organization(name,cr_number) values('مكتب الطابور','1010102020') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  // One notification per delivery. `notification_dedupe` keys on (org, kind, entity_id, due_date),
  // so each row needs its own entity_id — the same guard that stops the app raising one alert twice.
  const mkDelivery = async (ageDays, target) => {
    const n = (await one(
      "insert into app.notification(org_id,kind,entity_id,title) values($1,'charge_overdue',gen_random_uuid(),'تنبيه') returning id",
      [org])).id;
    return (await one(
      `insert into app.notification_delivery(org_id,notification_id,channel,target,created_at)
       values($1,$2,'email',$3, now() - make_interval(days => $4)) returning id`,
      [org, n, target, ageDays])).id;
  };

  const fresh = await mkDelivery(0, "fresh@example.com");
  const sixDays = await mkDelivery(6, "six@example.com");
  const eightDays = await mkDelivery(8, "eight@example.com");
  const ancient = await mkDelivery(120, "ancient@example.com");

  const claimed = (await q("select id from app.claim_email_deliveries(50)")).rows.map((r) => r.id);

  ok("today's delivery is claimed", claimed.includes(fresh));
  ok("six days old is still claimed — late is not the same as useless", claimed.includes(sixDays));
  ok("eight days old is NOT claimed", !claimed.includes(eightDays));
  ok("months old is NOT claimed", !claimed.includes(ancient));

  const stale = (await q("select id, status, last_error from app.notification_delivery where id = any($1)",
    [[eightDays, ancient]])).rows;
  ok("stale rows are retired, not left pending for ever",
    stale.every((r) => r.status === "failed"), JSON.stringify(stale));
  ok("…and each says why", stale.every((r) => /expired/.test(r.last_error ?? "")), JSON.stringify(stale));

  // The gauge on /platform/health counts pending rows. If expiry only skipped, this would still
  // count deliveries that are never going to happen — a number nobody can act on.
  const pending = await one(
    "select count(*)::int as n from app.notification_delivery where status='pending' and channel='email'");
  ok("queue depth means something again", pending.n === 2, JSON.stringify(pending));

  // The point of expiring the DELIVERY rather than the notification: the office still sees it.
  const notes = await one("select count(*)::int as n from app.notification where org_id=$1", [org]);
  ok("the notifications themselves are untouched — only the e-mail is dropped", notes.n === 4, JSON.stringify(notes));

  // Nothing above should have weakened who may call this.
  const authed = await one(
    "select has_function_privilege('authenticated', p.oid, 'execute') as g from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='claim_email_deliveries'");
  ok("claim_email_deliveries stays service_role only", authed.g === false);

  const ledger = await one("select version from app.schema_migration where version='0070'");
  ok("0070 recorded itself in the ledger", ledger !== undefined);
} finally {
  await stop();
}

console.log(`\nEmail backlog: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
