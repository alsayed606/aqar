"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/return-to";

// The platform console keeps its own sign-out rather than borrowing the office app's, so nothing
// in this space imports from /app — same separation the portals already keep.
export async function signOutPlatform() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Subscription override for one office (comp / extend trial / change plan or status). Empty fields
// are sent as null and leave the current value unchanged (operator_set_subscription coalesces).
// The RPC is operator-gated in SQL and writes an audit row. `back` lets the in-line editor on the
// list return there instead of the office page (validated against open redirects).
export async function setSubscription(formData: FormData) {
  const org = String(formData.get("org_id") ?? "");
  if (!org) redirect("/platform/tenants");
  const back = safeReturnTo(String(formData.get("back") ?? "")) ?? `/platform/tenants/${org}`;
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

// ---------------------------------------------------------------------------
// One-click levers. Each is a thin wrapper over the same gated, audited RPCs — the console never
// writes to app.org_subscription directly, so every route to a subscription change is logged.
// ---------------------------------------------------------------------------

const ERRORS_AR: Record<string, string> = {
  FORBIDDEN: "غير مصرّح",
  SUBSCRIPTION_NOT_FOUND: "لا يوجد اشتراك لهذا المكتب",
  NOT_TRIALING: "التمديد يخصّ الحسابات التجريبية فقط",
  INVALID_DAYS: "عدد أيام غير صالح",
  PLAN_NOT_FOUND: "الخطة غير موجودة",
};

function translate(message: string): string {
  const key = Object.keys(ERRORS_AR).find((k) => message.includes(k));
  return key ? ERRORS_AR[key] : message;
}

// Shared tail for every lever: read org + back, run the call, come back with ok or a readable error.
async function runLever(
  formData: FormData,
  // PromiseLike, not Promise: supabase.rpc() returns a thenable query builder, not a real promise.
  call: (org: string, supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string } | null }>,
) {
  const org = String(formData.get("org_id") ?? "");
  if (!org) redirect("/platform/tenants");
  const back = safeReturnTo(String(formData.get("back") ?? "")) ?? `/platform/tenants/${org}`;
  const withParam = (p: string) => `${back}${back.includes("?") ? "&" : "?"}${p}`;

  const supabase = await createClient();
  const { error } = await call(org, supabase);
  if (error) redirect(withParam(`error=${encodeURIComponent(translate(error.message))}`));
  redirect(withParam("ok=1"));
}

export async function extendTrial(formData: FormData) {
  const days = Number(formData.get("days") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim() || null;
  await runLever(formData, (org, supabase) =>
    supabase.rpc("operator_extend_trial", { p_org: org, p_days: days, p_reason: reason }));
}

export async function changePlan(formData: FormData) {
  const plan = String(formData.get("plan") ?? "").trim();
  await runLever(formData, (org, supabase) =>
    supabase.rpc("operator_set_subscription", { p_org: org, p_plan: plan }));
}

// Cutting an office off is the console's heaviest action, so the reason is required rather than
// optional: it lands in both the subscription notes and the audit row.
export async function suspendTenant(formData: FormData) {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    const org = String(formData.get("org_id") ?? "");
    redirect(`/platform/tenants/${org}?error=${encodeURIComponent("اكتب سبب الإيقاف")}`);
  }
  await runLever(formData, (org, supabase) =>
    supabase.rpc("operator_set_subscription", { p_org: org, p_status: "suspended", p_notes: reason }));
}

export async function reactivateTenant(formData: FormData) {
  await runLever(formData, (org, supabase) =>
    supabase.rpc("operator_set_subscription", { p_org: org, p_status: "active" }));
}

// Plan catalog. An empty limit field means UNLIMITED, not "unchanged" — the form always posts the
// whole row, so a blank box is a deliberate ceiling removal rather than an omission.
export async function upsertPlan(formData: FormData) {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const limit = (k: string) => {
    const v = text(k);
    return v === "" ? null : Number(v);
  };
  const back = "/platform/subscriptions";
  const withParam = (p: string) => `${back}?${p}`;

  const sar = Number(text("price_sar"));
  if (!Number.isFinite(sar) || sar < 0) redirect(withParam(`error=${encodeURIComponent("سعر غير صالح")}`));

  const supabase = await createClient();
  const { error } = await supabase.rpc("operator_upsert_plan", {
    p_code: text("code"),
    p_name_ar: text("name_ar"),
    p_price_halalas: Math.round(sar * 100),
    p_max_properties: limit("max_properties"),
    p_max_units: limit("max_units"),
    p_max_members: limit("max_members"),
    p_is_public: formData.get("is_public") === "on",
    p_sort: Number(text("sort") || 0),
  });
  if (error) {
    const messages: Record<string, string> = {
      INVALID_PLAN_CODE: "رمز الخطة يجب أن يكون حروفاً إنجليزية صغيرة",
      NAME_REQUIRED: "اسم الخطة مطلوب",
      INVALID_PRICE: "سعر غير صالح",
      INVALID_LIMIT: "حد غير صالح",
      FORBIDDEN: "غير مصرّح",
    };
    const key = Object.keys(messages).find((k) => error.message.includes(k));
    redirect(withParam(`error=${encodeURIComponent(key ? messages[key] : error.message)}`));
  }
  redirect(withParam("ok=1"));
}
