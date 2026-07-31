import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargeToken } from "@/lib/payments/moyasar";

export const dynamic = "force-dynamic";

const JOB = "renew-subscriptions";

// Vercel Cron (daily) recurring-renewal drainer. claim_due_renewals atomically leases each due
// subscription and opens an 'auto' payment intent (so overlapping runs never double-charge); we then
// charge the saved token off-session and apply / dunning. service_role is used ONLY here.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  // Every run leaves a mark, so the health page can tell "nothing was due" apart from "never ran".
  const record = (ok: boolean, detail: Record<string, unknown>, err?: string) =>
    admin.rpc("record_cron_run", {
      p_job: JOB, p_ok: ok, p_started_at: startedAt, p_detail: detail, p_error: err ?? null,
    });

  const { data, error } = await admin.rpc("claim_due_renewals", { p_max: 50 });
  if (error) {
    await record(false, {}, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Array<{
    intent_id: string;
    org_id: string;
    token: string;
    amount_halalas: number;
    plan_code: string;
  }>;
  if (rows.length === 0) {
    await record(true, { due: 0, charged: 0, failed: 0 });
    return NextResponse.json({ due: 0, charged: 0, failed: 0 });
  }

  let charged = 0;
  let failed = 0;
  for (const r of rows) {
    const result = await chargeToken({
      token: r.token,
      amountHalalas: Number(r.amount_halalas),
      description: `تجديد اشتراك عقار — خطة ${r.plan_code}`,
      metadata: { payment_intent: r.intent_id, org_id: r.org_id, kind: "renewal" },
    });

    if (result.ok && result.status === "paid") {
      await admin.rpc("apply_subscription_payment", { p_intent: r.intent_id, p_gateway_id: result.id, p_raw: result.raw ?? null });
      charged++;
    } else {
      const raw = result.ok ? { status: result.status, raw: result.raw } : { error: result.error };
      await admin.rpc("record_dunning_failure", { p_intent: r.intent_id, p_raw: raw });
      failed++;
    }
  }

  // Declined cards are an outcome of the run, not a failure of it — dunning already recorded each.
  await record(true, { due: rows.length, charged, failed });
  return NextResponse.json({ due: rows.length, charged, failed });
}
