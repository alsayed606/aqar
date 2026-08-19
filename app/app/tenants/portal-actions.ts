"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/provider";
import { renderPortalInviteEmail } from "@/lib/email/templates";
import { rpcErrorAr } from "@/lib/rpc-errors";
import type { FormState } from "@/lib/form-state";

// Portal access for one party, from the office's side (migrations 0074 + 0075).
//
// The office used to copy a link out of a box and send it themselves, and then knew nothing more.
// These actions send it, record that it was sent, and let it be withdrawn or replaced.

const REFUSALS: Array<[RegExp, string]> = [
  [/NO_CONTACT/i, "أضِف بريداً أو جوالاً للسجل أولاً."],
  [/ALREADY_LINKED/i, "الحساب مرتبط بالفعل. افكّ الارتباط قبل إرسال دعوة جديدة."],
  [/FORBIDDEN/i, "متاح لمدراء المنشأة فقط."],
  [/PARTY_NOT_FOUND/i, "السجل غير موجود."],
  [/REASON_REQUIRED/i, "اكتب سبب فكّ الارتباط."],
];

const said = (message: string): string =>
  REFUSALS.find(([re]) => re.test(message))?.[1] ?? rpcErrorAr(message) ?? message;

async function origin(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
}

/**
 * Issue a fresh invitation and send it.
 *
 * Rotation happens in the database (0075): whatever was live is retired first, so there is never
 * more than one live link per profile. The send is recorded only if the provider accepted it —
 * "sent" must mean sent, or the office reads a state that never happened.
 */
export async function sendPortalInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const partyId = String(formData.get("party_id") ?? "");
  const orgName = String(formData.get("org_name") ?? "المكتب");
  if (!partyId) return { error: "سجلّ غير معروف" };

  const supabase = await createClient();

  // Checked BEFORE issuing anything. resend_portal_invitation retires the live token as its first
  // act, so discovering the missing address afterwards would leave the office worse off than before
  // the click: the old link dead, and no new one sent.
  const { data: party } = await supabase.from("party").select("email").eq("id", partyId).maybeSingle();
  if (!party?.email) {
    return { error: "لا يوجد بريد إلكتروني لهذا السجل. أضِفه من «تعديل البيانات» ثم أرسل الدعوة." };
  }

  const { data: token, error } = await supabase.rpc("resend_portal_invitation", { p_party: partyId });
  if (error) return { error: said(error.message) };

  // The address is read back from the invitation the database just wrote, not from the form: the
  // rule about who may accept (0074) is matched against that row, and the message must go to it.
  const { data: invite } = await supabase
    .from("invitation")
    .select("id, email")
    .eq("party_id", partyId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invite?.email) {
    return {
      error: "أُنشئت الدعوة، لكن لا يوجد بريد لإرسالها إليه. أضِف بريداً ثم أعد الإرسال.",
    };
  }

  const link = `${await origin()}/portal/join?token=${token}`;
  const mail = renderPortalInviteEmail({ orgName, link });
  const sent = await sendEmail({ to: invite.email, ...mail });
  if (!sent.ok) {
    // The invitation exists and is live; only the delivery failed. Saying so plainly beats a generic
    // failure that would push the office to click again and rotate a link that was never sent.
    console.error("[portal-invite]", sent.error);
    return { error: "أُنشئت الدعوة ولم يتمكّن النظام من إرسالها. حاول «إعادة الإرسال» بعد قليل." };
  }

  // The provider's id is kept (0077), not discarded. "أُرسلت" means Resend accepted the message —
  // usually the same thing as delivered, occasionally not, and this is the only thread from our row
  // to the provider's log when a tenant says nothing arrived.
  const { error: markError } = await supabase.rpc("mark_invitation_sent", {
    p_invitation: invite.id,
    p_channel: "email",
    p_to: invite.email,
    p_message_id: sent.id,
  });
  if (markError) console.error("[portal-invite] mark_sent", markError.message);

  revalidatePath("/app/tenants");
  return { ok: `أُرسلت الدعوة إلى ${invite.email}` };
}

export async function revokePortalInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const partyId = String(formData.get("party_id") ?? "");
  if (!partyId) return { error: "سجلّ غير معروف" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_portal_invitation", {
    p_party: partyId,
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  if (error) return { error: said(error.message) };

  revalidatePath("/app/tenants");
  return { ok: Number(data) > 0 ? "أُلغيت الدعوة." : "لا توجد دعوة قائمة." };
}

/**
 * Detach a profile from the login it was linked to.
 *
 * Without it a profile linked to the wrong account can never be re-invited: acceptance refuses a
 * linked party. The reason is required by the database, and it is what the audit log carries.
 */
export async function unlinkPortalAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  const partyId = String(formData.get("party_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!partyId) return { error: "سجلّ غير معروف" };
  if (!reason) return { error: "اكتب سبب فكّ الارتباط.", field: "reason", values: { reason } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("unlink_party_identity", { p_party: partyId, p_reason: reason });
  if (error) return { error: said(error.message), values: { reason } };

  revalidatePath("/app/tenants");
  return { ok: "فُكّ ارتباط الحساب. يمكنك إرسال دعوة جديدة الآن." };
}
