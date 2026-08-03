"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { parseArabicNumber } from "@/lib/num";
import { sarToHalalas } from "@/lib/money";

export type MeterState = { error?: string; ok?: boolean };
export type ReadingState = { error?: string; ok?: boolean };
export type BillState = { error?: string; ok?: boolean };

const UTILITY_TYPES = ["electricity", "water"];

// The database rejects the two mistakes that matter (a duplicate number, a unit from another
// property). Turning those into Arabic is all the UI has to add.
function translateMeterError(message: string, meterNumber: string): string {
  if (/utility_meter_number_uq|duplicate key/i.test(message)) {
    return `رقم العدّاد "${meterNumber}" مسجَّل بالفعل لنفس نوع المرفق في هذه المنشأة.`;
  }
  if (/utility_meter_unit_id_property_id_fkey|violates foreign key/i.test(message)) {
    return "الوحدة المختارة لا تتبع هذا العقار.";
  }
  return message;
}

function revalidateMeter(propertyId: string) {
  revalidatePath("/app/utilities");
  revalidatePath("/app/utilities/readings");
  revalidatePath(`/app/properties/${propertyId}`);
}

export async function createMeter(
  _prev: MeterState,
  formData: FormData,
): Promise<MeterState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const property_id = String(formData.get("property_id") ?? "");
  const meter_number = String(formData.get("meter_number") ?? "").trim();
  const utility_type = String(formData.get("utility_type") ?? "");
  if (!property_id) return { error: "اختر العقار" };
  if (!meter_number) return { error: "رقم العدّاد مطلوب" };
  if (!UTILITY_TYPES.includes(utility_type)) return { error: "نوع المرفق غير صحيح" };

  // Empty means a main meter for the whole property — the design's default, not a missing value.
  const unit_id = String(formData.get("unit_id") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("utility_meter").insert({
    org_id: activeOrg,
    property_id,
    unit_id,
    utility_type,
    meter_number,
    account_number: String(formData.get("account_number") ?? "").trim() || null,
    subscription_number: String(formData.get("subscription_number") ?? "").trim() || null,
    provider: String(formData.get("provider") ?? "").trim() || null,
    installed_at: String(formData.get("installed_at") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { error: translateMeterError(error.message, meter_number) };

  revalidateMeter(property_id);
  return { ok: true };
}

// Archiving ('inactive') and removal ('removed') are the same control. The CHECK constraint ties
// 'removed' to a removal date, so the date is sent with it and cleared with any other status.
export async function setMeterStatus(formData: FormData) {
  const meter_id = String(formData.get("meter_id") ?? "");
  const property_id = String(formData.get("property_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const back = String(formData.get("back") ?? "/app/utilities");
  if (!meter_id || !["active", "inactive", "removed"].includes(status)) redirect(back);

  const removed_at =
    status === "removed"
      ? String(formData.get("removed_at") ?? "").trim() || new Date().toISOString().slice(0, 10)
      : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("utility_meter")
    .update({ status, removed_at })
    .eq("id", meter_id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidateMeter(property_id);
  redirect(back);
}

export async function deleteMeter(formData: FormData) {
  const meter_id = String(formData.get("meter_id") ?? "");
  const property_id = String(formData.get("property_id") ?? "");
  const back = String(formData.get("back") ?? "/app/utilities");
  if (!meter_id) redirect(back);

  const supabase = await createClient();
  const { error } = await supabase
    .from("utility_meter")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", meter_id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidateMeter(property_id);
  redirect(back);
}

export async function createReading(
  _prev: ReadingState,
  formData: FormData,
): Promise<ReadingState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const meter_id = String(formData.get("meter_id") ?? "");
  const reading_date = String(formData.get("reading_date") ?? "").trim();
  const value = parseArabicNumber(String(formData.get("value") ?? ""));
  if (!meter_id) return { error: "اختر العدّاد" };
  if (!reading_date) return { error: "تاريخ القراءة مطلوب" };
  if (value == null || value < 0) return { error: "أدخل قراءة صحيحة (رقم غير سالب)" };

  const supabase = await createClient();
  const { error } = await supabase.from("utility_reading").insert({
    org_id: activeOrg,
    meter_id,
    reading_date,
    value,
    is_reset: formData.get("is_reset") === "on",
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (error) {
    if (/READING_IN_FUTURE/.test(error.message)) {
      return { error: "لا يمكن تسجيل قراءة بتاريخ لم يأتِ بعد." };
    }
    if (/duplicate key/i.test(error.message)) {
      return { error: "لهذا العدّاد قراءة مسجَّلة في نفس التاريخ." };
    }
    return { error: error.message };
  }

  revalidatePath("/app/utilities/readings");
  return { ok: true };
}

// Answer to "this reading is lower than the last one": the office confirms the meter was replaced.
// Marking is_reset is what turns the blank consumption into "the reading itself", per the rule in
// docs/foundation/09-utilities-module.md §3 — the system never infers this on its own.
export async function markReadingReset(formData: FormData) {
  const reading_id = String(formData.get("reading_id") ?? "");
  const back = String(formData.get("back") ?? "/app/utilities/readings");
  if (!reading_id) redirect(back);

  const supabase = await createClient();
  const { error } = await supabase
    .from("utility_reading")
    .update({ is_reset: true })
    .eq("id", reading_id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/app/utilities/readings");
  redirect(back);
}

// The other answer: the number was mistyped. Correcting it re-evaluates consumption on its own,
// because consumption is a view over the readings and is not stored anywhere.
export async function updateReadingValue(formData: FormData) {
  const reading_id = String(formData.get("reading_id") ?? "");
  const back = String(formData.get("back") ?? "/app/utilities/readings");
  const value = parseArabicNumber(String(formData.get("value") ?? ""));
  if (!reading_id) redirect(back);
  if (value == null || value < 0) {
    redirect(`${back}?error=${encodeURIComponent("أدخل قراءة صحيحة (رقم غير سالب)")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("utility_reading")
    .update({ value })
    .eq("id", reading_id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/app/utilities/readings");
  redirect(back);
}

export async function deleteReading(formData: FormData) {
  const reading_id = String(formData.get("reading_id") ?? "");
  const back = String(formData.get("back") ?? "/app/utilities/readings");
  if (!reading_id) redirect(back);

  const supabase = await createClient();
  const { error } = await supabase
    .from("utility_reading")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", reading_id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/app/utilities/readings");
  redirect(back);
}

// A billing month is a month. The form sends "2026-03" (an <input type="month">); the CHECK
// constraint would reject any day other than the first, so the day is fixed here rather than left
// to whatever the browser posts.
function firstOfMonth(input: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(input.trim());
  if (m) return `${m[1]}-${m[2]}-01`;
  const d = /^(\d{4})-(\d{2})-\d{2}$/.exec(input.trim());
  return d ? `${d[1]}-${d[2]}-01` : null;
}

export async function createBill(
  _prev: BillState,
  formData: FormData,
): Promise<BillState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const meter_id = String(formData.get("meter_id") ?? "");
  const billing_month = firstOfMonth(String(formData.get("billing_month") ?? ""));
  if (!meter_id) return { error: "اختر العدّاد" };
  if (!billing_month) return { error: "اختر شهر الفاتورة" };

  const amount_halalas = sarToHalalas(String(formData.get("amount") ?? ""));
  if (amount_halalas == null || amount_halalas < 0) return { error: "أدخل قيمة الاستهلاك بالريال" };
  const vat_halalas = sarToHalalas(String(formData.get("vat") ?? "")) ?? 0;
  const other_fees_halalas = sarToHalalas(String(formData.get("other_fees") ?? "")) ?? 0;
  if (vat_halalas < 0 || other_fees_halalas < 0) return { error: "لا تُقبل مبالغ سالبة" };

  const supabase = await createClient();
  const { error } = await supabase.from("utility_bill").insert({
    org_id: activeOrg,
    meter_id,
    billing_month,
    previous_reading: parseArabicNumber(String(formData.get("previous_reading") ?? "")),
    current_reading: parseArabicNumber(String(formData.get("current_reading") ?? "")),
    amount_halalas,
    vat_halalas,
    other_fees_halalas,
    due_date: String(formData.get("due_date") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) {
    if (/utility_bill_month_uq|duplicate key/i.test(error.message)) {
      return { error: "لهذا العدّاد فاتورة مسجَّلة في نفس الشهر." };
    }
    return { error: error.message };
  }

  revalidatePath("/app/utilities/bills");
  return { ok: true };
}

// "Paid" is a date, not a status column (design note §2), so marking and unmarking a bill is the
// same write with a value or a null — there is no second field that could disagree with it.
export async function setBillPaid(formData: FormData) {
  const bill_id = String(formData.get("bill_id") ?? "");
  const back = String(formData.get("back") ?? "/app/utilities/bills");
  if (!bill_id) redirect(back);

  const paid_at = formData.get("unpay") === "1"
    ? null
    : String(formData.get("paid_at") ?? "").trim() || new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const { error } = await supabase.from("utility_bill").update({ paid_at }).eq("id", bill_id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/app/utilities/bills");
  redirect(back);
}

export async function deleteBill(formData: FormData) {
  const bill_id = String(formData.get("bill_id") ?? "");
  const back = String(formData.get("back") ?? "/app/utilities/bills");
  if (!bill_id) redirect(back);

  const supabase = await createClient();
  const { error } = await supabase
    .from("utility_bill")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", bill_id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/app/utilities/bills");
  redirect(back);
}
