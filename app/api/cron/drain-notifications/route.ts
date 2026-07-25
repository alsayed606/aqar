import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/provider";
import { renderNotificationEmail } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

// Vercel Cron drainer for the notification email outbox (0038). Idempotent + concurrency-safe:
// claim_email_deliveries atomically leases rows (SKIP LOCKED) so overlapping runs never double-send;
// each row is then sent once and marked sent/failed. service_role is used ONLY here.
//
// Vercel Cron issues a GET with `Authorization: Bearer <CRON_SECRET>`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = new URL(request.url).origin;

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "admin client error" },
      { status: 500 },
    );
  }

  // 1. Claim a batch of eligible email deliveries (attempts incremented, next_attempt_at leased).
  const { data: claimed, error: claimErr } = await admin.rpc("claim_email_deliveries", { p_max: 50 });
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  const rows = (claimed ?? []) as Array<{
    id: string;
    org_id: string;
    notification_id: string;
    target: string;
  }>;
  if (rows.length === 0) {
    return NextResponse.json({ claimed: 0, sent: 0, failed: 0 });
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

  return NextResponse.json({ claimed: rows.length, sent, failed });
}
