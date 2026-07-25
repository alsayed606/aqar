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
  const saveCard = String(formData.get("save_card") ?? "") === "1" ? "1" : "0";
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
    metadata: { payment_intent: String(intent.id), org_id: activeOrg, plan, save_card: saveCard },
  });
  if (!invoice.ok) {
    redirect("/app/subscription?error=" + encodeURIComponent("تعذّر بدء الدفع حالياً. حاول لاحقاً."));
  }

  redirect(invoice.url); // hand off to Moyasar's hosted payment page
}

// Toggle auto-renew (requires a saved card to enable). Admin-gated in SQL.
export async function setAutoRenew(formData: FormData) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const on = String(formData.get("on") ?? "") === "1";

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_auto_renew", { p_org: activeOrg, p_on: on });
  if (error) {
    const msg = /NO_PAYMENT_METHOD/i.test(error.message)
      ? "لا توجد بطاقة محفوظة. فعّل التجديد التلقائي عند الدفع القادم."
      : /FORBIDDEN/i.test(error.message)
        ? "متاح لمدير المنشأة فقط."
        : error.message;
    redirect("/app/subscription?error=" + encodeURIComponent(msg));
  }
  redirect("/app/subscription");
}

// Remove the saved card and turn auto-renew off.
export async function removeCard() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_payment_method", { p_org: activeOrg });
  if (error) {
    const msg = /FORBIDDEN/i.test(error.message) ? "متاح لمدير المنشأة فقط." : error.message;
    redirect("/app/subscription?error=" + encodeURIComponent(msg));
  }
  redirect("/app/subscription");
}
