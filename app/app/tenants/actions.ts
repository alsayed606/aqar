"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";

export type TenantState = { error?: string; ok?: boolean };

export async function createTenant(
  _prev: TenantState,
  formData: FormData,
): Promise<TenantState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const display_name = String(formData.get("display_name") ?? "").trim();
  if (!display_name) return { error: "اسم المستأجر مطلوب" };

  const legal_kind = String(formData.get("legal_kind") ?? "individual");
  const national_id = String(formData.get("national_id") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;

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
      email,
      roles: ["tenant"],
    })
    .select("id")
    .single();
  if (partyErr) return { error: partyErr.message };

  const { error: tenantErr } = await supabase.from("tenant").insert({
    org_id: activeOrg,
    party_id: party.id,
    tenant_kind: legal_kind,
  });
  if (tenantErr) return { error: tenantErr.message };

  revalidatePath("/app/tenants");
  return { ok: true };
}
