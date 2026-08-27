// Telling the tenant what happened to their maintenance request (migration 0078).
//
// Five claims, each of which fails silently if it breaks:
//   1. a status change addressed to the reporting party produces a notification and an email row;
//   2. the office does NOT see that row — it is the sender, not an audience;
//   3. the tenant DOES see it, and sees nobody else's;
//   4. the resolution note never travels (decision, 20 Aug 2026), and a return to 'open' says nothing;
//   5. the office's own notifications still reach the office exactly as before.
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

const { client, stop } = await bootWithMigrations(54365);
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

try {
  // ---------------- Seed ----------------
  const org = (await one("insert into app.organization(name) values('Maintenance Office') returning id")).id;
  await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [org]);

  const mkIdentity = async (phone, email) => (await one(
    "insert into app.identity(phone_e164, phone_raw, email) values($1,$1,$2) returning id", [phone, email])).id;
  const admin = await mkIdentity("+966500000201", "admin@office.example");
  const tenantLogin = await mkIdentity("+966500000202", null);
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [admin, org]);

  // 0013 forbids setting party.identity_id outside the accept RPC. This suite is about who reads a
  // notification, not about how a link is earned, so it sets the same session flag those RPCs set.
  const link = async (partyId, identityId) => {
    await q("select set_config('app.allow_party_link','on',false)");
    await q("update app.party set identity_id=$2 where id=$1", [partyId, identityId]);
    await q("select set_config('app.allow_party_link','off',false)");
  };

  const party = (await one(
    `insert into app.party(org_id,display_name,roles,national_id,email)
     values($1,'Tenant Sara',array['tenant']::app.party_role[],'1000000201','sara@example.com') returning id`,
    [org])).id;
  await link(party, tenantLogin);
  const tenant = (await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id", [org, party])).id;

  const ownerParty = (await one(
    `insert into app.party(org_id,display_name,roles,national_id)
     values($1,'Owner Faisal',array['owner']::app.party_role[],'1000000299') returning id`, [org])).id;
  const owner = (await one(
    "insert into app.owner(org_id,party_id,is_self) values($1,$2,false) returning id", [org, ownerParty])).id;
  const property = (await one(
    "insert into app.property(org_id,owner_id,name) values($1,$2,'Sara Tower') returning id", [org, owner])).id;
  const unit = (await one(
    "insert into app.unit(org_id,property_id,unit_number) values($1,$2,'12') returning id", [org, property])).id;

  const mkRequest = async () => (await one(
    `insert into app.maintenance_request(org_id,property_id,unit_id,reported_by_party_id,description)
     values($1,$2,$3,$4,'حنفية المطبخ تسرّب') returning id`, [org, property, unit, party])).id;

  const notesFor = async (req) => (await q(
    `select * from app.notification where entity_id = $1 and recipient_party_id is not null
      order by created_at`, [req])).rows;

  // ---------------- 1. The three transitions speak ----------------
  const req = await mkRequest();
  await q("update app.maintenance_request set status='in_progress' where id=$1", [req]);
  let rows = await notesFor(req);
  ok("starting work notifies the tenant", rows.length === 1 && rows[0].title === "بدأ العمل على طلبك");
  ok("the notice is addressed to the reporting party", rows[0].recipient_party_id === party);
  ok("it points at the tenant's own portal", rows[0].link_path === `/portal/tenant/${tenant}`);

  const deliveries = await q(
    "select target from app.notification_delivery where notification_id = $1", [rows[0].id]);
  ok("one email is queued, to the party's address",
    deliveries.rows.length === 1 && deliveries.rows[0].target === "sara@example.com");
  ok("the office is NOT emailed a copy of its own outgoing notice",
    !deliveries.rows.some((d) => d.target === "admin@office.example"));

  await q(
    "update app.maintenance_request set status='resolved', resolution_note='استدعينا فنّياً بـ٣٠٠ على المالك' where id=$1",
    [req]);
  rows = await notesFor(req);
  ok("closing notifies the tenant", rows.length === 2 && rows[1].title === "أُغلق طلبك");
  // The whole point of the 20 Aug decision: the office wrote that note believing it was private.
  ok("the resolution note never travels", !rows.some((r) => (r.body ?? "").includes("٣٠٠")));
  ok("closing invites a correction", (rows[1].body ?? "").includes("إن لم يُعالَج"));

  const req2 = await mkRequest();
  await q("update app.maintenance_request set status='cancelled' where id=$1", [req2]);
  ok("refusing notifies the tenant", (await notesFor(req2))[0].title === "لم يُقبل طلبك");

  // ---------------- 2. Silence where silence is right ----------------
  await q("update app.maintenance_request set status='open' where id=$1", [req]);
  ok("returning to 'open' says nothing", (await notesFor(req)).length === 2);

  await q("update app.maintenance_request set status='in_progress' where id=$1", [req]);
  ok("re-entering a state already announced does not announce it twice",
    (await notesFor(req)).length === 2);

  const staffReq = (await one(
    `insert into app.maintenance_request(org_id,property_id,unit_id,description)
     values($1,$2,$3,'المصعد') returning id`, [org, property, unit])).id;
  await q("update app.maintenance_request set status='resolved' where id=$1", [staffReq]);
  ok("a request nobody reported notifies nobody", (await notesFor(staffReq)).length === 0);

  // ---------------- 3. Who can read it ----------------
  const officeSees = await asUser(admin, org, async () =>
    (await q("select count(*)::int as n from app.notification where recipient_party_id is not null")).rows[0].n);
  ok("the office does not see notices addressed to a tenant", officeSees === 0);

  const tenantSees = await asUser(tenantLogin, null, async () =>
    (await q("select count(*)::int as n from app.notification where recipient_party_id is not null")).rows[0].n);
  ok("the tenant sees their own notices", tenantSees === 3, `saw ${tenantSees}`);

  // A second tenant, to prove the policy filters by identity and not merely by "is addressed".
  const otherLogin = await mkIdentity("+966500000203", null);
  const otherParty = (await one(
    `insert into app.party(org_id,display_name,roles,national_id,email)
     values($1,'Tenant Omar',array['tenant']::app.party_role[],'1000000202','omar@example.com') returning id`,
    [org])).id;
  await link(otherParty, otherLogin);
  await q("insert into app.tenant(org_id,party_id) values($1,$2)", [org, otherParty]);
  const otherSees = await asUser(otherLogin, null, async () =>
    (await q("select count(*)::int as n from app.notification where recipient_party_id is not null")).rows[0].n);
  ok("a tenant sees nobody else's notices", otherSees === 0);

  // ---------------- 4. A party with no email ----------------
  const silentParty = (await one(
    `insert into app.party(org_id,display_name,roles,national_id)
     values($1,'Tenant Bilal',array['tenant']::app.party_role[],'1000000203') returning id`, [org])).id;
  await q("insert into app.tenant(org_id,party_id) values($1,$2)", [org, silentParty]);
  const silentReq = (await one(
    `insert into app.maintenance_request(org_id,property_id,unit_id,reported_by_party_id,description)
     values($1,$2,$3,$4,'الباب') returning id`, [org, property, unit, silentParty])).id;
  await q("update app.maintenance_request set status='resolved' where id=$1", [silentReq]);
  const silentNote = (await notesFor(silentReq))[0];
  ok("a tenant with no email still gets the in-app notice", silentNote !== undefined);
  ok("but no delivery is queued to nothing",
    (await q("select 1 from app.notification_delivery where notification_id=$1", [silentNote.id])).rows.length === 0);

  // ---------------- 5. The office's own notifications are untouched ----------------
  const officeNote = (await one(
    `insert into app.notification(org_id,property_id,kind,entity_type,entity_id,title,body)
     values($1,$2,'charge_overdue','charge',gen_random_uuid(),'دفعة متأخرة','—') returning id`,
    [org, property])).id;
  await q("select app.enqueue_notification_email($1)", [officeNote]);
  const officeTargets = await q(
    "select target from app.notification_delivery where notification_id=$1", [officeNote]);
  ok("office notifications still fan out to members",
    officeTargets.rows.length === 1 && officeTargets.rows[0].target === "admin@office.example");
  const officeReads = await asUser(admin, org, async () =>
    (await q("select count(*)::int as n from app.notification where id = $1", [officeNote])).rows[0].n);
  ok("and the office still reads them", officeReads === 1);

  // ---------------- 6. The bulk sweep must not mail the office its own outgoing tenant notices ----
  // This is the one that would have shipped silently: enqueue_email_deliveries_for takes every
  // unread row in the org, and every tenant notice is an unread row in the org.
  await q("select app.enqueue_email_deliveries_for($1)", [org]);
  const leaked = await one(
    `select count(*)::int as n
       from app.notification_delivery d
       join app.notification n on n.id = d.notification_id
      where n.recipient_party_id is not null and d.target = 'admin@office.example'`);
  ok("the sweep does not mail tenant notices to the office", leaked.n === 0, `leaked ${leaked.n}`);

  const unread = (await one("select app.generate_notifications_for($1) as n", [org])).n;
  const officeUnread = (await one(
    `select count(*)::int as n from app.notification
      where org_id = $1 and read_at is null and recipient_party_id is null`, [org])).n;
  ok("the unread gauge counts office work only", unread === officeUnread, `${unread} vs ${officeUnread}`);

  // ---------------- 7. Photos (0079) ----------------
  // The storage half is skipped on bare Postgres — there is no storage schema — so what is provable
  // here is the pair of functions the application calls, which is where the rules live anyway.
  const folder = await asUser(tenantLogin, null, async () =>
    (await one("select app.maintenance_photo_folder($1) as f", [tenant])).f);
  ok("the folder is the tenant's own org and party", folder === `${org}/${party}`);

  await expectThrow(
    "another tenant cannot ask for that folder",
    () => asUser(otherLogin, null, () => q("select app.maintenance_photo_folder($1)", [tenant])),
    "FORBIDDEN",
  );

  const photoReq = await mkRequest();
  const path = `${folder}/${photoReq}.jpg`;
  await asUser(tenantLogin, null, () => q("select app.attach_maintenance_photo($1,$2)", [photoReq, path]));
  ok("the tenant attaches a photo to their own request",
    (await one("select photo_path from app.maintenance_request where id=$1", [photoReq])).photo_path === path);

  // Evidence, not a draft. The person with the most reason to swap it holds this door.
  await expectThrow(
    "a photo cannot be replaced once set",
    () => asUser(tenantLogin, null, () => q("select app.attach_maintenance_photo($1,$2)", [photoReq, path + "x"])),
    "PHOTO_ALREADY_SET",
  );

  const strangerReq = await mkRequest();
  await expectThrow(
    "a stranger cannot attach a photo to someone else's request",
    () => asUser(otherLogin, null, () => q("select app.attach_maintenance_photo($1,$2)", [strangerReq, path])),
    "FORBIDDEN",
  );

  const line = await asUser(tenantLogin, null, async () =>
    (await q("select * from app.tenant_portal_maintenance($1) where id = $2", [tenant, photoReq])).rows[0]);
  ok("the tenant sees that a photo is attached", line.has_photo === true);
  ok("but never the path itself", !("photo_path" in line));

  // ---------------- 8. Erasure reaches the photo (0080) ----------------
  // The storage delete itself belongs to the drain; what the database owes is an honest nomination
  // and a confirmation that clears the column only after the file is gone.
  ok("a photo of a living party is not nominated",
    (await q("select 1 from app.claim_erased_photos(100) where request_id = $1", [photoReq])).rows.length === 0);

  await q("update app.party set erased_at = now(), erased_reason = 'طلب صاحب البيانات' where id = $1", [party]);
  const claimed = (await q("select * from app.claim_erased_photos(100)")).rows;
  ok("an erased party's photo is nominated with its path",
    claimed.length === 1 && claimed[0].request_id === photoReq && claimed[0].photo_path === path);

  await q("select app.mark_photo_purged($1)", [photoReq]);
  ok("confirming clears the column",
    (await one("select photo_path from app.maintenance_request where id=$1", [photoReq])).photo_path === null);
  ok("and it is not nominated twice",
    (await q("select 1 from app.claim_erased_photos(100)")).rows.length === 0);
  ok("the completed erasure is audited",
    (await one(
      `select count(*)::int as n from app.audit_log
        where action = 'maintenance.photo_purged' and entity_id = $1`, [photoReq])).n === 1);
} catch (e) {
  // Without this the finally's process.exit(0) swallows a setup failure and the run reports
  // "0 passed, 0 failed" — a green-looking suite that never ran.
  fail++;
  console.log("  FAIL  suite aborted -> " + (e?.message ?? e));
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await stop();
  process.exit(fail ? 1 : 0);
}
