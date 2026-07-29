"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/return-to";

// Platform-operator override of an org's subscription (comp / extend trial / change plan or status).
// Empty fields are sent as null and leave the current value unchanged (operator_set_subscription
// coalesces). The RPC is operator-gated in SQL. An optional `back` field lets the in-line editor on
// the /operator list return there instead of the org detail page (validated against open redirects).
export async function operatorSetSubscription(formData: FormData) {
  const org = String(formData.get("org_id") ?? "");
  if (!org) redirect("/operator");
  const back = safeReturnTo(String(formData.get("back") ?? "")) ?? `/operator/${org}`;
  const withParam = (p: string) => `${back}${back.includes("?") ? "&" : "?"}${p}`;

  const nullable = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };

  const supabase = await createClient();
  const { error } = await supabase.rpc("operator_set_subscription", {
    p_org: org,
    p_plan: nullable("plan"),
    p_status: nullable("status"),
    p_trial_ends_at: nullable("trial_ends_at"),
    p_period_end: nullable("period_end"),
    p_notes: nullable("notes"),
  });
  if (error) {
    const msg = /FORBIDDEN/i.test(error.message) ? "غير مصرّح" : error.message;
    redirect(withParam(`error=${encodeURIComponent(msg)}`));
  }
  redirect(withParam("ok=1"));
}
