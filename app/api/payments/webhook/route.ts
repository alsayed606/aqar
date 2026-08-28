import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSecret, extractCardToken } from "@/lib/payments/moyasar";

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

  // A 500 is not a failure to be hidden here: Moyasar retries on one, and every write below is
  // idempotent (apply_subscription_payment no-ops on an intent already paid). Answering `ok` to a
  // write that did not happen is what makes the retry never come.
  const retryable = (stage: string, message: string) => {
    console.error("[moyasar]", stage, intentId, message);
    return NextResponse.json({ error: `${stage} failed` }, { status: 500 });
  };

  if (status === "paid") {
    const { error } = await admin.rpc("apply_subscription_payment", {
      p_intent: intentId,
      p_gateway_id: gatewayId,
      p_raw: body,
    });
    if (error) return retryable("apply", error.message);

    // If the office opted into auto-renew, persist the returned card token (never the card itself).
    if (metadata.save_card === "1") {
      const card = extractCardToken(data);
      if (card) {
        // The org comes from the intent, not from the payload. save_payment_method is not just a
        // write: it retires whatever card that org had, attaches this one, and switches the
        // subscription to auto-renew. The authoritative owner is one lookup away, and a privileged
        // write should not take its target from the message that asked for it.
        const { data: intent } = await admin
          .from("subscription_payment")
          .select("org_id")
          .eq("id", intentId)
          .maybeSingle();

        if (!intent?.org_id) return retryable("intent lookup", "no org for intent");

        const { error: cardError } = await admin.rpc("save_payment_method", {
          p_org: intent.org_id,
          p_token: card.token,
          p_brand: card.brand,
          p_last4: card.last4,
          p_exp_month: null,
          p_exp_year: null,
        });
        // Silence here meant the office asked for auto-renew, believed it was on, and discovered
        // otherwise when the next renewal did not happen.
        if (cardError) return retryable("save card", cardError.message);
      }
    }
  } else if (status === "failed") {
    const { error } = await admin.rpc("mark_subscription_payment_failed", {
      p_intent: intentId,
      p_raw: body,
    });
    if (error) return retryable("mark failed", error.message);
  }

  return NextResponse.json({ ok: true });
}
