import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/provider";
import { renderNotificationEmail } from "@/lib/email/templates";
import { verifyBearer } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

const JOB = "drain-notifications";

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
    await record(true, { sweep, claimed: 0, sent: 0, failed: 0 });
    return NextResponse.json({ sweep, claimed: 0, sent: 0, failed: 0 });
  }

  // 2. Fetch the content (notification title/body) and org names for the claimed set.
  const notifIds = [...new Set(rows.map((r) => r.notification_id))];
  const orgIds = [...new Set(rows.map((r) => r.org_id))];
  const [{ data: notifs }, { data: orgs }] = await Promise.all([
    admin.from("notification").select("id, title, body").in("id", notifIds),
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
      link: `${origin}/app/notifications`,
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
  await record(true, { sweep, claimed: rows.length, sent, failed });
  return NextResponse.json({ sweep, claimed: rows.length, sent, failed });
}
