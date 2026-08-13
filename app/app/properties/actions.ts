"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { parseArabicNumber, parseArabicInt } from "@/lib/num";
import { translateSubscriptionError } from "@/lib/subscription-errors";
import { safeReturnTo } from "@/lib/return-to";
import { archiveRecord } from "@/lib/archive";
import type { FormState } from "@/lib/form-state";

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

  // Holding relationship (Sprint L, presentation only): owned = the org owns it (self-owner);
  // managed/investment = an external landlord, which must be chosen.
  const HOLDING = ["owned", "managed", "investment"];
  const holding_type = HOLDING.includes(String(formData.get("holding_type") ?? "")) ? String(formData.get("holding_type")) : "owned";
  const occ = String(formData.get("occupancy_type") ?? "").trim();
  const occupancy_type = occ === "family" || occ === "bachelor" ? occ : null;
  const toInt = (v: string) => { const n = parseArabicInt(v); return n; };

  const supabase = await createClient();

  // Owner: for an owned property use the org self-owner; otherwise the chosen external owner is required.
  let owner_id = String(formData.get("owner_id") ?? "").trim();
  if (holding_type === "owned" || !owner_id) {
    if (holding_type !== "owned" && !owner_id) return { error: "اختر المالك للعقار غير المملوك (إدارة/استثمار)." };
    const { data: self, error: selfErr } = await supabase
      .from("owner")
      .select("id")
      .eq("is_self", true)
      .limit(1)
      .maybeSingle();
    if (selfErr) return { error: selfErr.message };
    if (!self) return { error: "تعذّر إيجاد المالك الافتراضي للمنشأة" };
    if (holding_type === "owned") owner_id = self.id;
  }

  const { error } = await supabase.from("property").insert({
    org_id: activeOrg,
    owner_id,
    name,
    property_kind,
    city,
    district,
    deed_number,
    holding_type,
    property_code: String(formData.get("property_code") ?? "").trim() || null,
    property_type: String(formData.get("property_type") ?? "").trim() || null,
    occupancy_type,
    deed_type: String(formData.get("deed_type") ?? "").trim() || null,
    deed_date: String(formData.get("deed_date") ?? "").trim() || null,
    // water_meter / electricity_meter are deliberately NOT written any more. They predate the
    // utilities module (0063), which owns meters as records with readings and bills; keeping both
    // writable gave every meter number two homes and no answer for which one was current. The
    // columns stay in the table so values already captured are not lost — the property page shows
    // them and points at the real thing.
    planned_residential_units: toInt(String(formData.get("planned_residential_units") ?? "")),
    planned_commercial_units: toInt(String(formData.get("planned_commercial_units") ?? "")),
  });
  if (error) return { error: translateSubscriptionError(error.message) ?? error.message };

  revalidatePath("/app/properties");
  return { ok: true };
}

// Soft-delete a property. Refused by 0067 while it still has units or contracts.
export async function deleteProperty(formData: FormData) {
  const property_id = String(formData.get("property_id") ?? "");
  if (!property_id) redirect("/app/properties");

  await archiveRecord("property", property_id, "/app/properties");
  revalidatePath("/app/properties");
  redirect("/app/properties");
}

// Soft-delete a unit. Refused by 0067 while any contract still points at it.
export async function deleteUnit(formData: FormData) {
  const unit_id = String(formData.get("unit_id") ?? "");
  // `back` rides in a hidden field, so it is caller input: validated, never followed as given.
  const back = safeReturnTo(String(formData.get("back") ?? "")) ?? "/app/units";
  if (!unit_id) redirect(back);

  await archiveRecord("unit", unit_id, back);
  revalidatePath("/app/units");
  redirect(back);
}

// Reassign a property to a different owner (e.g., from the self-owner to a real client).
export async function changePropertyOwner(_prev: FormState, formData: FormData): Promise<FormState> {
  const property_id = String(formData.get("property_id") ?? "");
  const owner_id = String(formData.get("owner_id") ?? "");
  if (!property_id || !owner_id) return { error: "اختر المالك" };
  const supabase = await createClient();
  const { error } = await supabase.from("property").update({ owner_id }).eq("id", property_id);
  if (error) return { error: error.message };
  revalidatePath(`/app/properties/${property_id}`);
  return { ok: "غُيّر مالك العقار." };
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
    return { error: translateSubscriptionError(error.message) ?? error.message };
  }

  revalidatePath(`/app/properties/${property_id}`);
  revalidatePath("/app/units");
  return { ok: true };
}

// Edit a unit's mutable fields (unit numbering, status, size). RLS (manage_data) gates the write.
export async function updateUnit(_prev: FormState, formData: FormData): Promise<FormState> {
  const unit_id = String(formData.get("unit_id") ?? "");
  if (!unit_id) return { error: "وحدة غير معروفة" };

  // The `back` field is gone with the redirect it existed for: the drawer stays open on a refusal
  // and closes itself on success, so nothing needs to be told where the user came from.
  const unit_number = String(formData.get("unit_number") ?? "").trim();
  const typed: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && key !== "unit_id") typed[key] = value;
  }
  if (!unit_number) return { error: "رقم الوحدة مطلوب", field: "unit_number", values: typed };

  const patch = {
    unit_number,
    current_status: String(formData.get("current_status") ?? "vacant"),
    floor: String(formData.get("floor") ?? "").trim() || null,
    area_sqm: parseArabicNumber(String(formData.get("area_sqm") ?? "")),
    bedrooms: parseArabicInt(String(formData.get("bedrooms") ?? "")),
    bathrooms: parseArabicInt(String(formData.get("bathrooms") ?? "")),
  };

  const supabase = await createClient();
  const { error } = await supabase.from("unit").update(patch).eq("id", unit_id);
  if (error) {
    const duplicate = /duplicate key|unit_number/i.test(error.message);
    return {
      error: duplicate ? `رقم الوحدة "${unit_number}" مستخدم بالفعل في هذا العقار.` : error.message,
      field: duplicate ? "unit_number" : undefined,
      values: typed,
    };
  }
  revalidatePath("/app/units");
  return { ok: "حُفظت الوحدة." };
}
