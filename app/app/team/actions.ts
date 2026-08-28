"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";
import { translateSubscriptionError } from "@/lib/subscription-errors";
import { WRITE_REFUSED_AR, writeRefused, refusalAr, type Refusals } from "@/lib/rpc-errors";
import type { FormState } from "@/lib/form-state";

export type InviteState = { error?: string; field?: string; link?: string; role?: string };

const MEMBER_ROLES = ["admin", "manager", "accountant", "staff", "viewer"];

const SCOPE_REFUSALS: Refusals = [
  [/MEMBERSHIP_NOT_FOUND/i, "العضو غير موجود"],
  [/SCOPE_UPDATE_REFUSED|FORBIDDEN/i, "تعديل النطاق متاح لمدراء المنشأة فقط."],
  // The UI only ever offers this org's properties, so reaching this means the request did not come
  // from the UI. Said plainly rather than as a generic failure.
  [/PROPERTY_NOT_IN_ORG/i, "أحد العقارات المختارة لا يتبع هذه المنشأة."],
];

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
  const { error, data } = await supabase
    .from("invitation")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitation_id)
    .is("accepted_at", null)
    .select("id");
  if (error) return { error: error.message };
  // Zero rows here also covers the honest race: the invitation was accepted a moment ago.
  if (writeRefused(data)) return { error: "لم تُلغَ الدعوة: إمّا أنها قُبلت بالفعل، أو لا تملك صلاحية عليها." };
  revalidatePath("/app/team");
  return { ok: "أُلغيت الدعوة." };
}

export async function setMemberRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const membership_id = String(formData.get("membership_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!membership_id || !["owner", ...MEMBER_ROLES].includes(role)) return { error: "دور غير صالح" };

  const supabase = await createClient();
  const { error, data } = await supabase.from("membership").update({ role }).eq("id", membership_id).select("id");
  if (error) {
    return {
      error: /LAST_OWNER/i.test(error.message)
        ? "لا يمكن إنزال دور المالك الوحيد للمنشأة"
        : error.message,
    };
  }
  // membership_update is admin-only. A non-admin reaching this action changes nothing and must not
  // be told the role was saved.
  if (writeRefused(data)) return { error: WRITE_REFUSED_AR };
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
  const { error, data } = await supabase.from("membership").update({ status }).eq("id", membership_id).select("id");
  if (error) {
    return {
      error: /LAST_OWNER|last.owner/i.test(error.message)
        ? "لا يمكن تعطيل المالك الوحيد للمنشأة"
        : error.message,
    };
  }
  if (writeRefused(data)) return { error: WRITE_REFUSED_AR };
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

  // One call, one transaction (0084). This was three writes with nothing holding them together —
  // set the flag, delete every scope row, insert the chosen ones — and stopping after the second
  // left the member scoped to NOTHING: an empty portfolio, while the admin read an error and
  // reasonably concluded that nothing had changed.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_scope", {
    p_membership: membership_id,
    p_scope_all: scopeAll,
    p_property_ids: scopeAll ? [] : propertyIds,
  });
  if (error) return { error: refusalAr(error.message, SCOPE_REFUSALS) };

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
