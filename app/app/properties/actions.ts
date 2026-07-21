"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { parseArabicNumber, parseArabicInt } from "@/lib/num";

export type PropState = { error?: string; ok?: boolean };
export type UnitState = { error?: string; ok?: boolean };

export async function createProperty(
  _prev: PropState,
  formData: FormData,
): Promise<PropState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "اسم العقار مطلوب" };

  const property_kind = String(formData.get("property_kind") ?? "residential");
  const city = String(formData.get("city") ?? "").trim() || null;
  const district = String(formData.get("district") ?? "").trim() || null;
  const deed_number = String(formData.get("deed_number") ?? "").trim() || null;

  const supabase = await createClient();

  // Default owner = the organization's auto self-owner (the office managing its own record).
  const { data: owner, error: ownerErr } = await supabase
    .from("owner")
    .select("id")
    .eq("is_self", true)
    .limit(1)
    .maybeSingle();
  if (ownerErr) return { error: ownerErr.message };
  if (!owner) return { error: "تعذّر إيجاد المالك الافتراضي للمنشأة" };

  const { error } = await supabase.from("property").insert({
    org_id: activeOrg,
    owner_id: owner.id,
    name,
    property_kind,
    city,
    district,
    deed_number,
  });
  if (error) return { error: error.message };

  revalidatePath("/app/properties");
  return { ok: true };
}

export async function createUnit(
  _prev: UnitState,
  formData: FormData,
): Promise<UnitState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const property_id = String(formData.get("property_id") ?? "");
  const unit_number = String(formData.get("unit_number") ?? "").trim();
  if (!property_id) return { error: "العقار غير محدّد" };
  if (!unit_number) return { error: "رقم الوحدة مطلوب" };

  const current_status = String(formData.get("current_status") ?? "vacant");
  const floor = String(formData.get("floor") ?? "").trim() || null;
  const area_sqm = parseArabicNumber(String(formData.get("area_sqm") ?? ""));
  const bedrooms = parseArabicInt(String(formData.get("bedrooms") ?? ""));
  const bathrooms = parseArabicInt(String(formData.get("bathrooms") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.from("unit").insert({
    org_id: activeOrg,
    property_id,
    unit_number,
    current_status,
    floor,
    area_sqm,
    bedrooms,
    bathrooms,
  });
  if (error) {
    if (/duplicate key|unit_number/i.test(error.message)) {
      return { error: `رقم الوحدة "${unit_number}" مستخدم بالفعل في هذا العقار.` };
    }
    return { error: error.message };
  }

  revalidatePath(`/app/properties/${property_id}`);
  return { ok: true };
}
