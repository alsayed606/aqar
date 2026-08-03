"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";

export type PrivacyState = { error?: string; ok?: string };

function translate(message: string): string {
  if (/FORBIDDEN/i.test(message)) return "متاح لمدراء المنشأة فقط.";
  if (/ERASE_ACTIVE_CONTRACT/i.test(message)) return "لا يمكن حذف بيانات مستأجر لديه عقد نشط. أنهِ العقد أولاً.";
  if (/PARTY_NOT_FOUND/i.test(message)) return "السجل غير موجود.";
  return message;
}

// The export is produced by the database in one call (0061) and handed straight to the browser as a
// download. It is deliberately not paginated or streamed: a portability request is answered with the
// whole record set or it is not answered.
export async function exportOrgData(): Promise<{ error?: string; json?: string }> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_org_data", { p_org: activeOrg });
  if (error) return { error: translate(error.message) };
  return { json: JSON.stringify(data, null, 2) };
}

export async function requestDeletion(_prev: PrivacyState, formData: FormData): Promise<PrivacyState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  // Typed confirmation rather than a checkbox: this schedules the destruction of a business's
  // records, and the cost of an accidental click is not symmetric with the cost of one extra step.
  if (String(formData.get("confirm") ?? "").trim() !== "حذف") {
    return { error: 'اكتب كلمة «حذف» للتأكيد.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_org_deletion", {
    p_org: activeOrg,
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  if (error) return { error: translate(error.message) };
  revalidatePath("/app/privacy");
  return { ok: `جُدوِل الحذف بتاريخ ${new Date(String(data)).toLocaleDateString("ar-SA")}.` };
}

export async function cancelDeletion() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const supabase = await createClient();
  await supabase.rpc("cancel_org_deletion", { p_org: activeOrg });
  revalidatePath("/app/privacy");
  redirect("/app/privacy?ok=1");
}

// Erasure of one data subject, run by the office. We are the processor here — the office is the
// controller, so this is their action to take, not ours.
export async function erasePartyData(formData: FormData) {
  const activeOrg = await getActiveOrg();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const partyId = String(formData.get("party_id") ?? "");
  if (!activeOrg || !tenantId || !partyId) redirect("/app/tenants");

  if (String(formData.get("confirm") ?? "").trim() !== "حذف") {
    redirect(`/app/tenants/${tenantId}?error=${encodeURIComponent('اكتب كلمة «حذف» للتأكيد.')}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erase_party", {
    p_org: activeOrg,
    p_party: partyId,
    p_reason: String(formData.get("reason") ?? "").trim() || "طلب صاحب البيانات",
  });
  if (error) redirect(`/app/tenants/${tenantId}?error=${encodeURIComponent(translate(error.message))}`);

  // The count of retained invoices is surfaced, not hidden: the office has to be able to tell the
  // data subject exactly what was kept and under which obligation.
  const kept = Number((data as { invoices_retained?: number } | null)?.invoices_retained ?? 0);
  const note = kept > 0
    ? `حُذفت البيانات الشخصية. احتُفظ بـ ${kept} فاتورة ضريبية بحكم النظام.`
    : "حُذفت البيانات الشخصية.";
  revalidatePath("/app/tenants");
  redirect(`/app/tenants/${tenantId}?ok=${encodeURIComponent(note)}`);
}
