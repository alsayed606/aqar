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

const PHOTO_BUCKET = "maintenance-photos";
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Put the photo where the request can find it (0079).
 *
 * Runs AFTER the request exists, and returns a sentence when it fails rather than throwing: the
 * fault is already reported by then, and telling the tenant their report was lost because a picture
 * would not upload is both untrue and the surest way to stop them reporting the next one.
 */
async function attachPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  requestId: string,
  photo: File,
): Promise<string | null> {
  const ext = PHOTO_TYPES[photo.type];
  if (!ext) return "الصورة بصيغة غير مدعومة. استخدم JPG أو PNG.";
  if (photo.size > PHOTO_MAX_BYTES) return "الصورة أكبر من ٥ ميغابايت.";

  // The path prefix comes from the database: a tenant cannot read their own party row, so the app
  // has no way to build it, and guessing would just fail the bucket's write policy.
  const { data: folder, error: folderError } = await supabase.rpc("maintenance_photo_folder", {
    p_tenant: tenantId,
  });
  if (folderError || !folder) return "تعذّر رفع الصورة.";

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(`${folder}/${requestId}.${ext}`, photo, { contentType: photo.type });
  if (uploadError) {
    if (/Bucket not found/i.test(uploadError.message)) return "لم تُنشأ مساحة الصور بعد — طبّق الهجرة 0079";
    console.error("[maintenance-photo]", uploadError.message);
    return "تعذّر رفع الصورة.";
  }

  const { error: attachError } = await supabase.rpc("attach_maintenance_photo", {
    p_request: requestId,
    p_path: `${folder}/${requestId}.${ext}`,
  });
  if (attachError) {
    console.error("[maintenance-photo] attach", attachError.message);
    return "رُفعت الصورة ولم تُربط بالطلب.";
  }
  return null;
}

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
  // Submitted without the photo, which is attached afterwards (0079). The database refuses a request
  // for reasons it alone knows — no active contract, the daily allowance — and an upload that
  // preceded the refusal would leave a file in the bucket that the tenant is not allowed to delete.
  const { data: requestId, error } = await supabase.rpc("submit_maintenance_request", {
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

  const photo = formData.get("photo");
  const photoProblem =
    photo instanceof File && photo.size > 0 && typeof requestId === "string"
      ? await attachPhoto(supabase, tenantId, requestId, photo)
      : null;

  revalidatePath(`/portal/tenant/${tenantId}`);
  // The answer stays on screen rather than fading: the tenant needs to know the office has it, and
  // a toast that vanishes leaves them wondering whether the button worked at all.
  return {
    ok: photoProblem
      ? `وصل طلبك إلى المكتب — لكن ${photoProblem} يمكنك إرسالها للمكتب مباشرة.`
      : "وصل طلبك إلى المكتب. ستجده في قائمة طلباتك بحالته.",
  };
}
