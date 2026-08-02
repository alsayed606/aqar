"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";
import { isEstablishment, tenantErrorAr, type EntityType, type PersonIdKind } from "@/lib/tenant-identity";

export type TenantState = { error?: string; ok?: boolean };

const ENTITY_TYPES: EntityType[] = ["individual", "sole_establishment", "company"];
const PERSON_ID_KINDS: PersonIdKind[] = ["national_id", "iqama_id", "passport_no"];

// The party columns that carry a tenant's identity. Building them in one place keeps create and
// update from drifting apart — the two used to repeat the same conditional nulling.
function identityFields(formData: FormData): { values: Record<string, string | null>; error?: string } {
  const raw = (key: string) => String(formData.get(key) ?? "").trim() || null;
  const entity_type = (ENTITY_TYPES as string[]).includes(String(formData.get("tenant_type") ?? ""))
    ? (String(formData.get("tenant_type")) as EntityType)
    : "individual";

  // Personal identifiers: one value plus the kind it belongs to, so citizen / resident / visitor
  // are distinguishable instead of all landing in national_id.
  const id_kind = (PERSON_ID_KINDS as string[]).includes(String(formData.get("id_kind") ?? ""))
    ? (String(formData.get("id_kind")) as PersonIdKind)
    : "national_id";
  const id_number = raw("id_number");

  const values: Record<string, string | null> = {
    legal_kind: entity_type === "company" ? "company" : "individual",
    entity_type,
    national_id: null,
    iqama_id: null,
    passport_no: null,
    unified_number: null,
    cr_number: null,
    vat_number: null,
    cr_expiry: null,
    rep_name: null,
    rep_id_number: null,
    rep_capacity: null,
    rep_phone_raw: null,
    rep_phone_e164: null,
    id_exempt_reason: raw("id_exempt_reason"),
  };

  if (isEstablishment(entity_type)) {
    values.unified_number = raw("unified_number");
    values.cr_number = raw("cr_number");
    values.vat_number = raw("vat_number");
    values.cr_expiry = raw("cr_expiry");
    values.rep_name = raw("rep_name");
    values.rep_id_number = raw("rep_id_number");
    values.rep_capacity = raw("rep_capacity");
    const repPhone = raw("rep_phone");
    if (repPhone) {
      const e164 = normalizeSaudiPhone(repPhone);
      if (!e164) return { values, error: "جوال الممثل غير صالح (مثال: 05XXXXXXXX)" };
      values.rep_phone_raw = repPhone;
      values.rep_phone_e164 = e164;
    }
  } else {
    values[id_kind] = id_number;
  }
  return { values };
}

// Applied when CREATING only. Editing an older record left incomplete is deliberately permitted —
// it carries a "بيانات ناقصة" badge instead — and the 0057 trigger still refuses to let a complete
// record be emptied back out.
function identityRequirementError(values: Record<string, string | null>): string | undefined {
  if (values.id_exempt_reason) return undefined;
  if (isEstablishment(String(values.entity_type))) {
    if (!values.unified_number) return "الرقم الموحّد مطلوب للمؤسسة والشركة (أو سجّل سبب إعفاء)";
    if (!(values.rep_name && values.rep_id_number && values.rep_phone_e164)) {
      return "بيانات ممثل المنشأة مطلوبة: الاسم والهوية والجوال";
    }
    return undefined;
  }
  if (!(values.national_id || values.iqama_id || values.passport_no)) {
    return "رقم الهوية أو الإقامة أو الجواز مطلوب";
  }
  return undefined;
}
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

  const identity = identityFields(formData);
  if (identity.error) return { error: identity.error };
  const missing = identityRequirementError(identity.values);
  if (missing) return { error: missing };

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
      phone_e164,
      phone_raw: phoneRaw || null,
      email,
      roles: ["tenant"],
      ...identity.values,
    })
    .select("id")
    .single();
  if (partyErr) return { error: tenantErrorAr(partyErr.message) };

  // tenant_type / tenant_kind are derived from party.entity_type by trigger (0057).
  const { error: tenantErr } = await supabase.from("tenant").insert({
    org_id: activeOrg,
    party_id: party.id,
  });
  if (tenantErr) return { error: tenantErrorAr(tenantErr.message) };

  revalidatePath("/app/tenants");
  return { ok: true };
}

// Brand names under one commercial registration (0057). Each carries its own municipal licence,
// and a contract copies the name it was signed under.
export async function addTradeName(formData: FormData) {
  const activeOrg = await getActiveOrg();
  const tenant_id = String(formData.get("tenant_id") ?? "");
  const party_id = String(formData.get("party_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!activeOrg || !tenant_id || !party_id) redirect("/app/tenants");
  if (!name) redirect(`/app/tenants/${tenant_id}?error=${encodeURIComponent("اسم تجاري مطلوب")}`);

  const supabase = await createClient();
  const { error } = await supabase.from("trade_name").insert({
    org_id: activeOrg,
    party_id,
    name,
    municipal_license_no: String(formData.get("municipal_license_no") ?? "").trim() || null,
    license_expiry: String(formData.get("license_expiry") ?? "").trim() || null,
  });
  if (error) {
    const ar = /duplicate|unique/i.test(error.message) ? "هذا الاسم التجاري مضاف مسبقاً" : error.message;
    redirect(`/app/tenants/${tenant_id}?error=${encodeURIComponent(ar)}`);
  }
  revalidatePath(`/app/tenants/${tenant_id}`);
  redirect(`/app/tenants/${tenant_id}?ok=1`);
}

export async function removeTradeName(formData: FormData) {
  const tenant_id = String(formData.get("tenant_id") ?? "");
  const id = String(formData.get("trade_name_id") ?? "");
  if (!tenant_id || !id) redirect("/app/tenants");

  const supabase = await createClient();
  // Soft delete: contracts keep the name they were signed under either way.
  const { error } = await supabase.from("trade_name").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) redirect(`/app/tenants/${tenant_id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/app/tenants/${tenant_id}`);
  redirect(`/app/tenants/${tenant_id}?ok=1`);
}

// Edit an existing tenant (party fields + tenant_type). RLS (manage_data) gates the write.
export async function updateTenant(formData: FormData) {
  const tenant_id = String(formData.get("tenant_id") ?? "");
  const party_id = String(formData.get("party_id") ?? "");
  if (!tenant_id || !party_id) redirect("/app/tenants");

  const display_name = String(formData.get("display_name") ?? "").trim();
  if (!display_name) redirect(`/app/tenants/${tenant_id}?error=${encodeURIComponent("الاسم مطلوب")}`);

  // No completeness check here on purpose: a record that predates 0057 must stay correctable.
  const identity = identityFields(formData);
  if (identity.error) redirect(`/app/tenants/${tenant_id}?error=${encodeURIComponent(identity.error)}`);

  const phoneRaw = String(formData.get("phone") ?? "").trim();
  let phone_e164: string | null = null;
  if (phoneRaw) {
    phone_e164 = normalizeSaudiPhone(phoneRaw);
    if (!phone_e164) redirect(`/app/tenants/${tenant_id}?error=${encodeURIComponent("رقم جوال غير صالح")}`);
  }

  const supabase = await createClient();
  const { error: pErr } = await supabase
    .from("party")
    .update({
      display_name,
      email: String(formData.get("email") ?? "").trim() || null,
      phone_e164,
      phone_raw: phoneRaw || null,
      ...identity.values,
    })
    .eq("id", party_id);
  if (pErr) redirect(`/app/tenants/${tenant_id}?error=${encodeURIComponent(tenantErrorAr(pErr.message))}`);

  revalidatePath("/app/tenants");
  redirect(`/app/tenants/${tenant_id}?ok=1`);
}
