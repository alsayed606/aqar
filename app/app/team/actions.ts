"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";

export type InviteState = { error?: string; link?: string; role?: string };

const MEMBER_ROLES = ["admin", "manager", "accountant", "staff", "viewer"];

// Admin mints an invitation; the raw token is returned once and rendered as a join link in-page
// (kept out of the URL). Only the token hash is stored server-side.
export async function createInvitation(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const role = String(formData.get("role") ?? "staff");
  if (!MEMBER_ROLES.includes(role)) return { error: "دور غير صالح" };

  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizeSaudiPhone(phoneRaw);
    if (!phone) return { error: "رقم جوال غير صالح (مثال: 05XXXXXXXX)" };
  }
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

export async function revokeInvitation(formData: FormData) {
  const invitation_id = String(formData.get("invitation_id") ?? "");
  if (!invitation_id) redirect("/app/team");
  const supabase = await createClient();
  await supabase
    .from("invitation")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitation_id)
    .is("accepted_at", null);
  revalidatePath("/app/team");
  redirect("/app/team");
}

export async function setMemberRole(formData: FormData) {
  const membership_id = String(formData.get("membership_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!membership_id || !["owner", ...MEMBER_ROLES].includes(role)) {
    redirect(`/app/team?error=${encodeURIComponent("دور غير صالح")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("membership").update({ role }).eq("id", membership_id);
  if (error) {
    const msg = /LAST_OWNER/i.test(error.message)
      ? "لا يمكن إنزال دور المالك الوحيد للمنشأة"
      : error.message;
    redirect(`/app/team?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/app/team");
  redirect("/app/team");
}

export async function setMemberStatus(formData: FormData) {
  const membership_id = String(formData.get("membership_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!membership_id || !["active", "suspended", "revoked"].includes(status)) {
    redirect(`/app/team?error=${encodeURIComponent("حالة غير صالحة")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("membership").update({ status }).eq("id", membership_id);
  if (error) {
    const msg = /LAST_OWNER|last.owner/i.test(error.message)
      ? "لا يمكن تعطيل المالك الوحيد للمنشأة"
      : error.message;
    redirect(`/app/team?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/app/team");
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
      : error.message;
    redirect(`/app/join?token=${encodeURIComponent(token)}&error=${encodeURIComponent(msg)}`);
  }
  redirect("/app?joined=1");
}
