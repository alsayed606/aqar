"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { createInvoice } from "@/lib/payments/moyasar";
import { refusalAr, type Refusals } from "@/lib/rpc-errors";
import type { FormState } from "@/lib/form-state";

// The office's own money: the plan it pays us for, and how.
//
// These five actions were the last in the product still answering through `?error=` in the URL. That
// reloads the page and empties the form, which on this screen meant the office retyped the bank
// transfer reference it had just copied off its banking app. They return a FormState now — except
// where success is a genuine destination, and Moyasar's payment page is one.

const ADMIN_ONLY: readonly [RegExp, string] = [/FORBIDDEN/i, "متاح لمدير المنشأة فقط."];

const CHECKOUT_REFUSALS: Refusals = [
  [/FORBIDDEN/i, "الدفع متاح لمدير المنشأة فقط."],
  [/PLAN_NOT_PURCHASABLE/i, "هذه الخطة غير متاحة للشراء الذاتي. تواصل معنا."],
  [/PLAN_NOT_FOUND/i, "الخطة غير موجودة."],
];

const OFFLINE_REFUSALS: Refusals = [
  ADMIN_ONLY,
  [/OFFLINE_REQUEST_PENDING/i, "لديك طلب تحويل قيد المراجعة. ألغِه أولاً إن أردت تغييره."],
  [/PLAN_NOT_PURCHASABLE/i, "هذه الخطة غير متاحة للشراء الذاتي. تواصل معنا."],
];

const CARD_REFUSALS: Refusals = [
  ADMIN_ONLY,
  [/NO_PAYMENT_METHOD/i, "لا توجد بطاقة محفوظة. فعّل التجديد التلقائي عند الدفع القادم."],
];

/**
 * Start a card payment: record the intent, ask Moyasar for a hosted invoice, hand the office over.
 *
 * Success redirects, and that is right — Moyasar's page is where the payment happens, not a message
 * about it. Only the refusals come back as state.
 */
export async function startSubscriptionCheckout(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const plan = String(formData.get("plan") ?? "").trim();
  const saveCard = String(formData.get("save_card") ?? "") === "1" ? "1" : "0";
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  if (!plan) return { error: "اختر خطة أولاً." };

  const supabase = await createClient();
  const { data: intent, error } = await supabase.rpc("create_subscription_payment", {
    p_org: activeOrg,
    p_plan: plan,
  });
  if (error || !intent) {
    return { error: error ? refusalAr(error.message, CHECKOUT_REFUSALS) : "تعذّر بدء الدفع." };
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const invoice = await createInvoice({
    amountHalalas: Number(intent.amount_halalas),
    description: `اشتراك عقار — خطة ${plan}`,
    callbackUrl: `${origin}/app/subscription?checkout=return`,
    metadata: { payment_intent: String(intent.id), org_id: activeOrg, plan, save_card: saveCard },
  });

  if (!invoice.ok) {
    // The intent exists and will never be paid: nobody asked the gateway for it. Left alone it sits
    // in the money table forever as an office stuck mid-checkout, because SELECT is all the office
    // is granted on that table (0082 gives it this one way out).
    console.error("[checkout]", invoice.error);
    const { error: abandonError } = await supabase.rpc("abandon_subscription_payment", {
      p_intent: intent.id,
    });
    if (abandonError) console.error("[checkout] orphan intent", intent.id, abandonError.message);
    return { error: "تعذّر بدء الدفع حالياً. حاول لاحقاً." };
  }

  redirect(invoice.url); // hand off to Moyasar's hosted payment page
}

/**
 * Declare a transfer or cash payment the office has already made (0062).
 *
 * Records an INTENT only — the plan is granted when an operator confirms the money arrived, never on
 * submission. The reference is the field that made this worth fixing: it is copied from a banking
 * app, and a refusal used to send the office back to fetch it again.
 */
export async function declareOfflinePayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const plan = String(formData.get("plan") ?? "").trim();
  const method = String(formData.get("method") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const values = { plan, method, reference };

  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  if (!plan) return { error: "اختر خطة أولاً.", field: "plan", values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_offline_payment", {
    p_org: activeOrg,
    p_plan: plan,
    p_method: method === "cash" ? "cash" : "bank_transfer",
    p_reference: reference || null,
  });
  if (error) return { error: refusalAr(error.message, OFFLINE_REFUSALS), values };

  revalidatePath("/app/subscription");
  return { ok: "سجّلنا طلبك. سيُفعّل اشتراكك بعد تأكيد وصول المبلغ." };
}

export async function cancelOfflinePayment(_prev: FormState): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_offline_payment", { p_org: activeOrg });
  if (error) return { error: refusalAr(error.message, OFFLINE_REFUSALS) };

  revalidatePath("/app/subscription");
  return { ok: "أُلغي طلب التحويل." };
}

/** Toggle auto-renew (requires a saved card to enable). Admin-gated in SQL. */
export async function setAutoRenew(_prev: FormState, formData: FormData): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const on = String(formData.get("on") ?? "") === "1";

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_auto_renew", { p_org: activeOrg, p_on: on });
  if (error) return { error: refusalAr(error.message, CARD_REFUSALS) };

  revalidatePath("/app/subscription");
  return { ok: on ? "فُعِّل التجديد التلقائي." : "أُوقف التجديد التلقائي." };
}

/** Remove the saved card and turn auto-renew off. */
export async function removeCard(_prev: FormState): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_payment_method", { p_org: activeOrg });
  if (error) return { error: refusalAr(error.message, CARD_REFUSALS) };

  revalidatePath("/app/subscription");
  return { ok: "أُزيلت البطاقة وأُوقف التجديد التلقائي." };
}
