"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/return-to";
import { platformErrorAr } from "@/lib/platform";

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
  if (error) redirect(withParam(`error=${encodeURIComponent(platformErrorAr(error.message))}`));
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

// ---------------------------------------------------------------------------
// Broadcast. Two steps on purpose: preview counts the audience and writes nothing, and only then
// can the send run. Reaching every customer at once is the least reversible action in this console,
// so the number is shown before it happens rather than after.
// ---------------------------------------------------------------------------

export type BroadcastResult = { ok: boolean; sent?: boolean; orgs?: number; emails?: number; error?: string };

function readBroadcast(formData: FormData) {
  const audience: Record<string, string> = {};
  const status = String(formData.get("status") ?? "").trim();
  const plan = String(formData.get("plan") ?? "").trim();
  if (status) audience.status = status;
  if (plan) audience.plan = plan;
  return {
    p_title: String(formData.get("title") ?? "").trim(),
    p_body: String(formData.get("body") ?? "").trim() || null,
    p_audience: audience,
    p_channel: formData.get("channel") === "in_app_email" ? "in_app_email" : "in_app",
  };
}

async function callBroadcast(formData: FormData, dryRun: boolean): Promise<BroadcastResult> {
  const args = readBroadcast(formData);
  if (!args.p_title) return { ok: false, error: "العنوان مطلوب" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_broadcast", { ...args, p_dry_run: dryRun });
  if (error) return { ok: false, error: platformErrorAr(error.message) };
  const result = data as { orgs: number; emails: number };
  return { ok: true, sent: !dryRun, orgs: result.orgs, emails: result.emails };
}

export async function previewBroadcast(_prev: BroadcastResult, formData: FormData) {
  return callBroadcast(formData, true);
}

export async function sendBroadcast(_prev: BroadcastResult, formData: FormData) {
  const result = await callBroadcast(formData, false);
  if (result.ok) revalidatePath("/platform/broadcast");
  return result;
}

// Feature flags and platform settings.
export async function saveFlag(formData: FormData) {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("operator_set_flag", {
    p_key: text("key"),
    p_label_ar: text("label_ar"),
    p_description: text("description") || null,
    p_is_enabled: formData.get("is_enabled") === "on",
    p_rollout_percent: Number(text("rollout_percent") || 0),
    p_required_plan: text("required_plan") || null,
    p_is_beta: formData.get("is_beta") === "on",
  });
  if (error) redirect(`/platform/features?error=${encodeURIComponent(platformErrorAr(error.message))}`);
  redirect("/platform/features?ok=1");
}

export async function saveSetting(formData: FormData) {
  const key = String(formData.get("key") ?? "").trim();
  const raw = String(formData.get("value") ?? "").trim();
  const numeric = formData.get("kind") === "number";
  // An empty box is not zero. Number("") is 0, and a trial_days of 0 would provision an office that
  // is locked out the moment it is created — so a blank numeric field is refused, not coerced.
  if (numeric && raw === "") {
    redirect(`/platform/settings?error=${encodeURIComponent("القيمة مطلوبة")}`);
  }
  // Every setting is stored as JSON; numbers stay numbers so validation in SQL can check ranges.
  const value = numeric ? Number(raw) : raw;
  if (numeric && !Number.isFinite(value as number)) {
    redirect(`/platform/settings?error=${encodeURIComponent("قيمة رقمية غير صالحة")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("operator_set_setting", { p_key: key, p_value: value });
  if (error) redirect(`/platform/settings?error=${encodeURIComponent(platformErrorAr(error.message))}`);
  redirect("/platform/settings?ok=1");
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
  if (error) redirect(withParam(`error=${encodeURIComponent(platformErrorAr(error.message))}`));
  redirect(withParam("ok=1"));
}
