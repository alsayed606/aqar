"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";

// The tenant's only write in the whole product (0072).
//
// Everything that decides whether it is allowed lives in the database function: the active contract,
// the daily allowance, the org the request belongs to. This action does not re-implement any of it —
// it hands over what was typed and translates the refusal into the tenant's language.

const REFUSALS: Array<[RegExp, string]> = [
  [/NO_ACTIVE_CONTRACT/i, "لا يوجد عقد نشط على هذه الوحدة باسمك."],
  [/DESCRIPTION_REQUIRED/i, "اكتب وصف المشكلة."],
  [/DAILY_LIMIT/i, "بلغت الحد اليومي للطلبات. إن كان الأمر عاجلاً فاتصل بالمكتب مباشرة."],
];

export async function submitMaintenanceRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const unitId = String(formData.get("unit_id") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "other");
  const urgency = String(formData.get("urgency") ?? "normal");
  const values = { description, category, urgency, unit_id: unitId };

  if (!unitId) return { error: "اختر الوحدة", field: "unit_id", values };
  if (!description) return { error: "اكتب وصف المشكلة", field: "description", values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_maintenance_request", {
    p_unit: unitId,
    p_category: category,
    p_urgency: urgency,
    p_description: description,
    p_photo_path: null,
  });

  if (error) {
    const said = REFUSALS.find(([re]) => re.test(error.message))?.[1];
    return { error: said ?? error.message, values };
  }

  revalidatePath(`/portal/tenant/${tenantId}`);
  // The answer stays on screen rather than fading: the tenant needs to know the office has it, and
  // a toast that vanishes leaves them wondering whether the button worked at all.
  return { ok: "وصل طلبك إلى المكتب. ستجده في قائمة طلباتك بحالته." };
}
