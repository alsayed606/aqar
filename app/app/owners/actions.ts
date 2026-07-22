"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";
import { parseArabicNumber } from "@/lib/num";
import { sarToHalalas } from "@/lib/money";

export type OwnerState = { error?: string; ok?: boolean };

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
  if (partyErr) return { error: partyErr.message };

  const { error: ownerErr } = await supabase.from("owner").insert({
    org_id: activeOrg,
    party_id: party.id,
    is_self: false,
    owner_kind: legal_kind,
    iban,
    bank_name,
  });
  if (ownerErr) return { error: ownerErr.message };

  revalidatePath("/app/owners");
  return { ok: true };
}

// Record a payout (remittance) to the owner. A numbered voucher (RM-…) is assigned by the DB.
export async function recordRemittance(formData: FormData) {
  const activeOrg = await getActiveOrg();
  const owner_id = String(formData.get("owner_id") ?? "");
  if (!activeOrg || !owner_id) redirect(`/app/owners/${owner_id}`);

  const back = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...extra });
    redirect(`/app/owners/${owner_id}?${qs.toString()}`);
  };

  const amount = sarToHalalas(String(formData.get("amount") ?? ""));
  if (amount == null || amount <= 0) back({ error: "أدخل مبلغ التوريد" });

  const method = String(formData.get("method") ?? "bank_transfer");
  const remitted_at = String(formData.get("remitted_at") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const period_from = String(formData.get("period_from") ?? "").trim() || null;
  const period_to = String(formData.get("period_to") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("owner_remittance").insert({
    org_id: activeOrg,
    owner_id,
    amount_halalas: amount,
    method,
    remitted_at: new Date(remitted_at).toISOString(),
    period_from,
    period_to,
    reference,
  });
  if (error) back({ error: error.message });

  revalidatePath(`/app/owners/${owner_id}`);
  redirect(`/app/owners/${owner_id}`);
}

// Set the owner's tax identity (VAT + CR numbers) — used as the supplier on their properties' invoices.
export async function setOwnerTaxInfo(formData: FormData) {
  const owner_id = String(formData.get("owner_id") ?? "");
  if (!owner_id) redirect(`/app/owners/${owner_id}`);

  const vat_number = String(formData.get("vat_number") ?? "").trim().replace(/\s+/g, "") || null;
  const cr_number = String(formData.get("cr_number") ?? "").trim().replace(/\s+/g, "") || null;
  if (vat_number && !/^\d{15}$/.test(vat_number)) {
    redirect(`/app/owners/${owner_id}?error=${encodeURIComponent("الرقم الضريبي يجب أن يكون 15 رقماً")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("owner")
    .update({ vat_number, cr_number })
    .eq("id", owner_id);
  if (error) redirect(`/app/owners/${owner_id}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/app/owners/${owner_id}`);
  redirect(`/app/owners/${owner_id}`);
}

// Set the owner's management fee (% of collection) — replaces any existing percentage agreement.
export async function setOwnerFee(formData: FormData) {
  const activeOrg = await getActiveOrg();
  const owner_id = String(formData.get("owner_id") ?? "");
  const pct = parseArabicNumber(String(formData.get("percent") ?? ""));

  if (!activeOrg || !owner_id) redirect(`/app/owners/${owner_id}`);
  if (pct == null || pct < 0 || pct > 100) {
    redirect(`/app/owners/${owner_id}?error=${encodeURIComponent("نسبة غير صالحة (0–100)")}`);
  }
  const fraction = Math.round((pct / 100) * 10000) / 10000; // numeric(5,4)

  const supabase = await createClient();
  await supabase
    .from("management_agreement")
    .update({ deleted_at: new Date().toISOString(), deleted_reason: "fee_update" })
    .eq("owner_id", owner_id)
    .eq("fee_model", "percentage_of_collection")
    .is("deleted_at", null);

  const { error } = await supabase.from("management_agreement").insert({
    org_id: activeOrg,
    owner_id,
    valid_from: new Date().toISOString().slice(0, 10),
    fee_model: "percentage_of_collection",
    fee_percentage: fraction,
  });
  if (error) redirect(`/app/owners/${owner_id}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/app/owners/${owner_id}`);
  redirect(`/app/owners/${owner_id}`);
}
