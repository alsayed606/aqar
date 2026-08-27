import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/provider";
import { renderNotificationEmail } from "@/lib/email/templates";
import { verifyBearer } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

const JOB = "drain-notifications";

/**
 * Delete the photographs of erased parties, one file at a time (0080).
 *
 * One at a time, and each confirmed separately, because a batch that half-succeeds must leave the
 * files it could not remove still nominated — a row cleared for a file that is still in the bucket
 * would be the erasure lying about itself, which is worse than the erasure being a day late.
 */
async function purgeErasedPhotos(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ deleted: number; failed: number }> {
  const { data, error } = await admin.rpc("claim_erased_photos", { p_max: 100 });
  if (error) {
    console.error("[photo-purge] claim", error.message);
    return { deleted: 0, failed: 0 };
  }

  const rows = (data ?? []) as Array<{ request_id: string; photo_path: string }>;
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    const { error: removeError } = await admin.storage
      .from("maintenance-photos")
      .remove([row.photo_path]);
    if (removeError) {
      console.error("[photo-purge]", row.request_id, removeError.message);
      failed++;
      continue;
    }
    await admin.rpc("mark_photo_purged", { p_request: row.request_id });
    deleted++;
  }
  return { deleted, failed };
}

// Vercel Cron drainer for the notification email outbox (0038). Idempotent + concurrency-safe:
// claim_email_deliveries atomically leases rows (SKIP LOCKED) so overlapping runs never double-send;
// each row is then sent once and marked sent/failed. service_role is used ONLY here.
//
// Vercel Cron issues a GET with `Authorization: Bearer <CRON_SECRET>`.
export async function GET(request: Request) {
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = new URL(request.url).origin;
  const startedAt = new Date().toISOString();

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "admin client error" },
      { status: 500 },
    );
  }

  // Record every outcome, success or failure. A cron that silently stops firing looks exactly like a
  // cron with nothing to do, so the health page can only tell them apart if each run leaves a mark.
  const record = (ok: boolean, detail: Record<string, unknown>, error?: string) =>
    admin.rpc("record_cron_run", {
      p_job: JOB, p_ok: ok, p_started_at: startedAt, p_detail: detail, p_error: error ?? null,
    });

  // 0. Generate notifications and queue their e-mail for EVERY live office (0059). This used to run
  // during a page render, which meant an office nobody opened got no reminders at all — the overdue
  // notice depended on somebody already looking. A sweep failure is recorded but does not abort the
  // drain: the outbox may still hold deliveries queued by an earlier run.
  const { data: swept, error: sweepErr } = await admin.rpc("sweep_notifications");
  if (sweepErr) await record(false, { stage: "sweep" }, sweepErr.message);
  const sweep = (Array.isArray(swept) ? swept[0] : swept) ?? null;

  // 0b. Drop rate-limit buckets older than a day (0060). Cheap, and it keeps a table that only ever
  // grows under attack from growing forever.
  await admin.rpc("rate_limit_sweep");

  // 0b-bis. Photographs belonging to people whose data was erased (0080). This is the half of PDPL
  // erasure that SQL cannot perform: erase_party nulls the name, the ID and the phone, and leaves a
  // picture of the person's kitchen in a bucket. The column is cleared only after the object is
  // actually gone — clearing it first would lose the only pointer to the file.
  const purged = await purgeErasedPhotos(admin);
  if (purged.failed > 0) await record(false, { stage: "photos", ...purged }, "some photos not deleted");

  // 0c. And spent sign-in codes plus step-up records for sessions that can no longer exist (0069).
  // Note the codes themselves never travel this route: they are sent the moment they are asked for,
  // because a sign-in code that waits for tomorrow's 06:00 drain is not a sign-in code.
  await admin.rpc("mfa_sweep");

  // 1. Claim a batch of eligible email deliveries (attempts incremented, next_attempt_at leased).
  const { data: claimed, error: claimErr } = await admin.rpc("claim_email_deliveries", { p_max: 50 });
  if (claimErr) {
    await record(false, {}, claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  const rows = (claimed ?? []) as Array<{
    id: string;
    org_id: string;
    notification_id: string;
    target: string;
  }>;
  if (rows.length === 0) {
    await record(true, { sweep, purged, claimed: 0, sent: 0, failed: 0 });
    return NextResponse.json({ sweep, purged, claimed: 0, sent: 0, failed: 0 });
  }

  // 2. Fetch the content (notification title/body) and org names for the claimed set.
  const notifIds = [...new Set(rows.map((r) => r.notification_id))];
  const orgIds = [...new Set(rows.map((r) => r.org_id))];
  const [{ data: notifs }, { data: orgs }] = await Promise.all([
    admin.from("notification").select("id, title, body, link_path").in("id", notifIds),
    admin.from("organization").select("id, name").in("id", orgIds),
  ]);
  const notifById = new Map((notifs ?? []).map((n) => [n.id, n]));
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name as string]));

  // 3. Send each and record the outcome.
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const n = notifById.get(row.notification_id);
    if (!n) {
      await admin.rpc("mark_email_delivery_failed", { p_id: row.id, p_error: "notification not found", p_response: null });
      failed++;
      continue;
    }
    const { subject, text, html } = renderNotificationEmail({
      orgName: orgNameById.get(row.org_id) ?? "عقار",
      title: n.title as string,
      body: (n.body as string | null) ?? null,
      // The destination comes from the notification (0078). It used to be this staff page for every
      // message, which is a wall to a tenant being told their request was closed.
      link: `${origin}${(n.link_path as string | null) ?? "/app/notifications"}`,
    });

    const result = await sendEmail({ to: row.target, subject, text, html });
    if (result.ok) {
      await admin.rpc("mark_email_delivery_sent", {
        p_id: row.id,
        p_message_id: result.id,
        p_response: result.raw ?? null,
      });
      sent++;
    } else {
      await admin.rpc("mark_email_delivery_failed", {
        p_id: row.id,
        p_error: result.error,
        p_response: result.raw ?? null,
      });
      failed++;
    }
  }

  // The run itself succeeded even when individual messages did not — those are counted, not raised.
  await record(true, { sweep, purged, claimed: rows.length, sent, failed });
  return NextResponse.json({ sweep, purged, claimed: rows.length, sent, failed });
}
