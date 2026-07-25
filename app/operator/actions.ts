"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Platform-operator override of an org's subscription (comp / extend trial / change plan or status).
// Empty fields are sent as null and leave the current value unchanged (operator_set_subscription
// coalesces). The RPC is operator-gated in SQL.
export async function operatorSetSubscription(formData: FormData) {
  const org = String(formData.get("org_id") ?? "");
  if (!org) redirect("/operator");

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
    redirect(`/operator/${org}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/operator/${org}?ok=1`);
}
