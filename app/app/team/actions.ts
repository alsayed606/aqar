"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";
import { translateSubscriptionError } from "@/lib/subscription-errors";
import type { FormState } from "@/lib/form-state";

export type InviteState = { error?: string; field?: string; link?: string; role?: string };

const MEMBER_ROLES = ["admin", "manager", "accountant", "staff", "viewer"];

// The row actions below report through their return value, not through `?error=` on the URL.
//
// WHY A TOAST AND NOT A FIELD, HERE
// The settings page moved its messages under the inputs that caused them. These have no input to sit
// under: they are one button on one row of a table, and what they change is the row itself. So the
// answer is a toast — close to the pointer, gone when read, and it does not push the table down.
// Same principle as there, different shape: the message belongs where the action was taken.

// Admin mints an invitation; the raw token is returned once and rendered as a join link in-page
// (kept out of the URL). Only the token hash is stored server-side.
export async function createInvitation(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const role = String(formData.get("role") ?? "staff");
  if (!MEMBER_ROLES.includes(role)) return { error: "دور غير صالح", field: "role" };

  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizeSaudiPhone(phoneRaw);
    if (!phone) return { error: "رقم جوال غير صالح (مثال: 05XXXXXXXX)", field: "phone" };
  }
  // Neither one is "the" wrong field, so this one stays with the form as a whole.
  if (!phone && !email) return { error: "أدخل رقم جوال أو بريداً إلكترونياً" };

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_invitation", {
    p_phone: phone,
    p_email: email,
    p_role: role,
    p_scope_all: true,
    p_expires_days: 14,
  });
  if (error) {
    if (/FORBIDDEN/i.test(error.message)) return { error: "الدعوة متاحة للمدراء فقط" };
    return { error: error.message };
  }

  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  revalidatePath("/app/team");
  return { link: `${proto}://${host}/app/join?token=${token}`, role };
}

export async function revokeInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  const invitation_id = String(formData.get("invitation_id") ?? "");
  if (!invitation_id) return { error: "دعوة غير معروفة" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("invitation")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitation_id)
    .is("accepted_at", null);
  if (error) return { error: error.message };
  revalidatePath("/app/team");
  return { ok: "أُلغيت الدعوة." };
}

export async function setMemberRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const membership_id = String(formData.get("membership_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!membership_id || !["owner", ...MEMBER_ROLES].includes(role)) return { error: "دور غير صالح" };

  const supabase = await createClient();
  const { error } = await supabase.from("membership").update({ role }).eq("id", membership_id);
  if (error) {
    return {
      error: /LAST_OWNER/i.test(error.message)
        ? "لا يمكن إنزال دور المالك الوحيد للمنشأة"
        : error.message,
    };
  }
  revalidatePath("/app/team");
  return { ok: "حُفظ الدور." };
}

export async function setMemberStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const membership_id = String(formData.get("membership_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!membership_id || !["active", "suspended", "revoked"].includes(status)) {
    return { error: "حالة غير صالحة" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("membership").update({ status }).eq("id", membership_id);
  if (error) {
    return {
      error: /LAST_OWNER|last.owner/i.test(error.message)
        ? "لا يمكن تعطيل المالك الوحيد للمنشأة"
        : error.message,
    };
  }
  revalidatePath("/app/team");
  return { ok: status === "active" ? "فُعّل العضو." : "أُوقف العضو." };
}

// Restrict a member to specific properties (scope_all=false + membership_property_scope rows), or
// reopen everything (scope_all=true). RLS on the portfolio tables (has_property_access) enforces it.
export async function setMemberScope(_prev: FormState, formData: FormData): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  const membership_id = String(formData.get("membership_id") ?? "");
  if (!activeOrg || !membership_id) redirect("/app/team");

  const scopeAll = String(formData.get("scope_all") ?? "true") === "true";
  const propertyIds = formData.getAll("property_ids").map(String).filter(Boolean);

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("membership")
    .select("id")
    .eq("id", membership_id)
    .eq("org_id", activeOrg)
    .maybeSingle();
  if (!m) redirect("/app/team");

  const { error: uErr } = await supabase
    .from("membership")
    .update({ scope_all: scopeAll })
    .eq("id", membership_id);
  if (uErr) return { error: uErr.message };

  // Rewrite the scope set: clear, then add the chosen properties (only when scoped). The delete
  // error is checked because a silent failure here would leave stale grants and WIDEN the member's
  // access beyond what the admin selected.
  const { error: dErr } = await supabase
    .from("membership_property_scope")
    .delete()
    .eq("membership_id", membership_id);
  if (dErr) return { error: dErr.message };
  if (!scopeAll && propertyIds.length > 0) {
    const { error: iErr } = await supabase
      .from("membership_property_scope")
      .insert(propertyIds.map((property_id) => ({ membership_id, property_id })));
    if (iErr) return { error: iErr.message };
  }

  revalidatePath("/app/team");
  // Back to the team list on success only. A refusal keeps the admin on the page with their
  // selection intact — this form is a set of checkboxes that is tedious to rebuild.
  redirect("/app/team");
}

export async function acceptInvitation(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/app/join?error=missing");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    const msg = /INVITATION_INVALID/i.test(error.message)
      ? "الدعوة غير صالحة أو منتهية أو مستخدمة"
      : (translateSubscriptionError(error.message) ?? error.message);
    redirect(`/app/join?token=${encodeURIComponent(token)}&error=${encodeURIComponent(msg)}`);
  }
  redirect("/app?joined=1");
}
