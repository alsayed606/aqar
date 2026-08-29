"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";
import { parseArabicNumber } from "@/lib/num";
import { sarToHalalas } from "@/lib/money";
import { archiveRecord } from "@/lib/archive";
import { riyadhToday } from "@/lib/today";
import { refusalAr, WRITE_REFUSED_AR, writeRefused, type Refusals } from "@/lib/rpc-errors";
import type { FormState } from "@/lib/form-state";

export type OwnerState = { error?: string; ok?: boolean };

const OWNER_REFUSALS: Refusals = [
  [/owner_iban_chk|iban/i, "الآيبان غير صالح (SA ثم 22 رقماً)"],
  [/duplicate key/i, "هذا المالك مسجَّل بالفعل"],
];

const FEE_REFUSALS: Refusals = [
  [/INVALID_PERCENTAGE/i, "نسبة غير صالحة (0–100)"],
  [/OWNER_NOT_FOUND/i, "المالك غير موجود"],
  // The database refused to retire the old agreement, so it undid the new one rather than leave two
  // live. The office needs to know the fee did NOT change — silence here would be the worse answer.
  [/FEE_UPDATE_REFUSED/i, "لم تُحفظ النسبة: السجل خارج نطاق صلاحيتك. تواصل مع مدير المنشأة."],
];


// Soft-delete an owner. Refused by 0067 while they still hold properties, and refused outright for
// the org's own self-owner — that one is the office itself, and invoices read its tax identity.
export async function deleteOwner(formData: FormData) {
  const owner_id = String(formData.get("owner_id") ?? "");
  if (!owner_id) redirect("/app/owners");

  await archiveRecord("owner", owner_id, `/app/owners/${owner_id}`);
  revalidatePath("/app/owners");
  redirect("/app/owners");
}

// createOwnerInvite is gone (0085). It called create_owner_invitation, which minted a token without
// retiring the live one — so 0075's one-live-invitation index refused the second click outright —
// and handed back a link for the office to copy by hand. The owners screen now uses the same actions
// the tenant screen does: sendPortalInvite / revokePortalInvite / unlinkPortalAccount, keyed on the
// party. Nothing needed writing for that; the panel and the lifecycle were already party-shaped.

export async function createOwner(
  _prev: OwnerState,
  formData: FormData,
): Promise<OwnerState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const display_name = String(formData.get("display_name") ?? "").trim();
  if (!display_name) return { error: "اسم المالك مطلوب" };

  const legal_kind = String(formData.get("legal_kind") ?? "individual");
  const national_id = String(formData.get("national_id") ?? "").trim() || null;
  const iban = String(formData.get("iban") ?? "").trim().replace(/\s+/g, "") || null;
  const bank_name = String(formData.get("bank_name") ?? "").trim() || null;

  const phoneRaw = String(formData.get("phone") ?? "").trim();
  let phone_e164: string | null = null;
  if (phoneRaw) {
    phone_e164 = normalizeSaudiPhone(phoneRaw);
    if (!phone_e164) return { error: "رقم جوال غير صالح (مثال: 05XXXXXXXX)" };
  }

  const supabase = await createClient();

  const { data: party, error: partyErr } = await supabase
    .from("party")
    .insert({
      org_id: activeOrg,
      display_name,
      legal_kind,
      national_id,
      phone_e164,
      phone_raw: phoneRaw || null,
      roles: ["owner"],
    })
    .select("id")
    .single();
  if (partyErr) return { error: refusalAr(partyErr.message, []) };

  const { error: ownerErr } = await supabase.from("owner").insert({
    org_id: activeOrg,
    party_id: party.id,
    is_self: false,
    owner_kind: legal_kind,
    iban,
    bank_name,
  });
  if (ownerErr) {
    // The party exists and nothing points at it. Worse than the other orphans this codebase has
    // grown: the owners list joins through `owner`, so the row is reachable from no screen at all —
    // a name, a national id and a phone number sitting in the database with no way to see or erase
    // them. Whatever creates a row before a step that can fail owns the cleanup.
    const { error: cleanupError } = await supabase.from("party").delete().eq("id", party.id);
    if (cleanupError) console.error("[owners] orphan party", party.id, cleanupError.message);
    return { error: refusalAr(ownerErr.message, OWNER_REFUSALS) };
  }

  revalidatePath("/app/owners");
  return { ok: true };
}

// Record a payout (remittance) to the owner. A numbered voucher (RM-…) is assigned by the DB.
export async function recordRemittance(_prev: FormState, formData: FormData): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  const owner_id = String(formData.get("owner_id") ?? "");
  if (!activeOrg || !owner_id) return { error: "مالك غير معروف" };

  const rawAmount = String(formData.get("amount") ?? "");
  const amount = sarToHalalas(rawAmount);
  // Money and dates, typed by hand. Everything the office entered rides back on a refusal, because
  // rebuilding a payout row from memory is how the second attempt gets a different number.
  const typed = {
    amount: rawAmount,
    reference: String(formData.get("reference") ?? ""),
    remitted_at: String(formData.get("remitted_at") ?? ""),
    period_from: String(formData.get("period_from") ?? ""),
    period_to: String(formData.get("period_to") ?? ""),
  };
  if (amount == null || amount <= 0) {
    return { error: "أدخل مبلغ التوريد", field: "amount", values: typed };
  }

  const method = String(formData.get("method") ?? "bank_transfer");
  const remitted_at = typed.remitted_at.trim() || riyadhToday();

  const supabase = await createClient();
  const { error } = await supabase.from("owner_remittance").insert({
    org_id: activeOrg,
    owner_id,
    amount_halalas: amount,
    method,
    remitted_at: new Date(remitted_at).toISOString(),
    period_from: typed.period_from.trim() || null,
    period_to: typed.period_to.trim() || null,
    reference: typed.reference.trim() || null,
  });
  if (error) return { error: error.message, values: typed };

  revalidatePath(`/app/owners/${owner_id}`);
  return { ok: "سُجّل التوريد." };
}

// Set the owner's tax identity (VAT + CR numbers) — used as the supplier on their properties' invoices.
// Both forms below report through their return value: the message belongs under the box that holds
// the rejected number, and the number the owner's agent typed must survive the refusal.
export async function setOwnerTaxInfo(_prev: FormState, formData: FormData): Promise<FormState> {
  const owner_id = String(formData.get("owner_id") ?? "");
  if (!owner_id) return { error: "مالك غير معروف" };

  const vat_number = String(formData.get("vat_number") ?? "").trim().replace(/\s+/g, "") || null;
  const cr_number = String(formData.get("cr_number") ?? "").trim().replace(/\s+/g, "") || null;
  const typed = { vat_number, cr_number };
  if (vat_number && !/^\d{15}$/.test(vat_number)) {
    return { error: "الرقم الضريبي يجب أن يكون 15 رقماً", field: "vat_number", values: typed };
  }

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("owner")
    .update({ vat_number, cr_number })
    .eq("id", owner_id)
    .select("id");
  if (error) return { error: error.message, values: typed };
  if (writeRefused(data)) return { error: WRITE_REFUSED_AR, values: typed };

  revalidatePath(`/app/owners/${owner_id}`);
  return { ok: "حُفظت البيانات الضريبية." };
}

// Set the owner's management fee (% of collection) — replaces any existing percentage agreement.
export async function setOwnerFee(_prev: FormState, formData: FormData): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  const owner_id = String(formData.get("owner_id") ?? "");
  const raw = String(formData.get("percent") ?? "");
  const pct = parseArabicNumber(raw);

  if (!activeOrg || !owner_id) return { error: "مالك غير معروف" };
  if (pct == null || pct < 0 || pct > 100) {
    return { error: "نسبة غير صالحة (0–100)", field: "percent", values: { percent: raw } };
  }
  const fraction = Math.round((pct / 100) * 10000) / 10000; // numeric(5,4)

  // One call, one transaction (0083). This used to retire the old agreement and insert the new one
  // as two separate statements with nothing between them: whichever half failed alone left the owner
  // with two live fee agreements or none, and the retire was never even checked — an RLS refusal
  // matches zero rows and raises nothing.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_owner_fee", {
    p_owner: owner_id,
    p_percentage: fraction,
  });
  if (error) {
    return { error: refusalAr(error.message, FEE_REFUSALS), field: "percent", values: { percent: raw } };
  }

  revalidatePath(`/app/owners/${owner_id}`);
  return { ok: "حُفظت نسبة الأتعاب." };
}
