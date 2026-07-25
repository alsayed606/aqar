"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { createInvoice } from "@/lib/payments/moyasar";

// Start a subscription payment: record the intent (admin-gated in SQL), create a Moyasar hosted
// invoice, and redirect the office to Moyasar's payment page. Activation happens later via the
// webhook (apply_subscription_payment). We never handle card data.
export async function startSubscriptionCheckout(formData: FormData) {
  const plan = String(formData.get("plan") ?? "").trim();
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  if (!plan) redirect("/app/subscription?error=" + encodeURIComponent("اختر خطة أولاً."));

  const supabase = await createClient();
  const { data: intent, error } = await supabase.rpc("create_subscription_payment", {
    p_org: activeOrg,
    p_plan: plan,
  });
  if (error || !intent) {
    const msg = /FORBIDDEN/i.test(error?.message ?? "")
      ? "الدفع متاح لمدير المنشأة فقط."
      : /PLAN_NOT_PURCHASABLE/i.test(error?.message ?? "")
        ? "هذه الخطة غير متاحة للشراء الذاتي. تواصل معنا."
        : (error?.message ?? "تعذّر بدء الدفع.");
    redirect("/app/subscription?error=" + encodeURIComponent(msg));
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const invoice = await createInvoice({
    amountHalalas: Number(intent.amount_halalas),
    description: `اشتراك عقار — خطة ${plan}`,
    callbackUrl: `${origin}/app/subscription?checkout=return`,
    metadata: { payment_intent: String(intent.id), org_id: activeOrg, plan },
  });
  if (!invoice.ok) {
    redirect("/app/subscription?error=" + encodeURIComponent("تعذّر بدء الدفع حالياً. حاول لاحقاً."));
  }

  redirect(invoice.url); // hand off to Moyasar's hosted payment page
}
