import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSecret } from "@/lib/payments/moyasar";

export const dynamic = "force-dynamic";

// Moyasar webhook. Verifies the shared secret, then applies/records the payment via service_role
// (the only place it's used here). Idempotent end-to-end: apply_subscription_payment no-ops if the
// intent is already paid, so Moyasar's retries never double-activate.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { secret_token?: string; type?: string; data?: Record<string, unknown> }
    | null;
  if (!body) return NextResponse.json({ error: "bad payload" }, { status: 400 });

  if (!verifyWebhookSecret(body.secret_token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = (body.data ?? {}) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, string>;
  const intentId = metadata.payment_intent;
  const gatewayId = (data.id as string) ?? null;
  const status = data.status as string | undefined;
  if (!intentId) return NextResponse.json({ error: "no payment_intent in metadata" }, { status: 400 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  if (status === "paid") {
    const { error } = await admin.rpc("apply_subscription_payment", {
      p_intent: intentId,
      p_gateway_id: gatewayId,
      p_raw: body,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (status === "failed") {
    await admin.rpc("mark_subscription_payment_failed", { p_intent: intentId, p_raw: body });
  }

  return NextResponse.json({ ok: true });
}
