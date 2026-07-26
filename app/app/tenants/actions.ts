"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";

export type TenantState = { error?: string; ok?: boolean };
export type TenantInviteState = { error?: string; link?: string };

// Mint a portal invite for a tenant; the raw token is returned once as a join link (kept out of the URL).
export async function createTenantInvite(
  _prev: TenantInviteState,
  formData: FormData,
): Promise<TenantInviteState> {
  const tenant_id = String(formData.get("tenant_id") ?? "");
  if (!tenant_id) return { error: "مستأجر غير صالح" };

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_tenant_invitation", { p_tenant: tenant_id });
  if (error) {
    if (/TENANT_NO_CONTACT/i.test(error.message)) return { error: "أضِف جوالاً أو بريداً للمستأجر أولاً" };
    if (/FORBIDDEN/i.test(error.message)) return { error: "متاح للمدراء فقط" };
    return { error: error.message };
  }

  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return { link: `${proto}://${host}/portal/join?token=${token}` };
}

export async function createTenant(
  _prev: TenantState,
  formData: FormData,
): Promise<TenantState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const display_name = String(formData.get("display_name") ?? "").trim();
  if (!display_name) return { error: "اسم المستأجر مطلوب" };

  // Tenant legal form: individual / sole_establishment / company (Sprint J). legal_kind (the coarse
  // enum) is derived from it for backward compatibility.
  const TYPES = ["individual", "sole_establishment", "company"];
  const tenant_type = TYPES.includes(String(formData.get("tenant_type") ?? ""))
    ? String(formData.get("tenant_type"))
    : "individual";
  const legal_kind = tenant_type === "company" ? "company" : "individual";
  const isEstablishment = tenant_type !== "individual";

  const national_id = String(formData.get("national_id") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  // Establishment identifiers (all optional, so first entry is never blocked).
  const cr_number = String(formData.get("cr_number") ?? "").trim() || null;
  const vat_number = String(formData.get("vat_number") ?? "").trim() || null;
  const unified_number = String(formData.get("unified_number") ?? "").trim() || null;
  const cr_expiry = String(formData.get("cr_expiry") ?? "").trim() || null;

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
      // Only attach establishment identifiers for non-individual tenants.
      cr_number: isEstablishment ? cr_number : null,
      vat_number: isEstablishment ? vat_number : null,
      unified_number: isEstablishment ? unified_number : null,
      cr_expiry: isEstablishment ? cr_expiry : null,
    })
    .select("id")
    .single();
  if (partyErr) return { error: partyErr.message };

  const { error: tenantErr } = await supabase.from("tenant").insert({
    org_id: activeOrg,
    party_id: party.id,
    tenant_kind: legal_kind,
    tenant_type,
  });
  if (tenantErr) return { error: tenantErr.message };

  revalidatePath("/app/tenants");
  return { ok: true };
}
