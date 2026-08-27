"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { sarToHalalas } from "@/lib/money";
import { translateSubscriptionError } from "@/lib/subscription-errors";
import type { FormState } from "@/lib/form-state";

export type ContractState = { error?: string };

export async function createContract(
  _prev: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const unit_id = String(formData.get("unit_id") ?? "");
  const tenant_id = String(formData.get("tenant_id") ?? "");
  if (!unit_id) return { error: "اختر الوحدة" };
  if (!tenant_id) return { error: "اختر المستأجر" };

  const start_date = String(formData.get("start_date") ?? "");
  const end_date = String(formData.get("end_date") ?? "");
  if (!start_date || !end_date) return { error: "حدّد تاريخي البداية والنهاية" };
  if (end_date < start_date) return { error: "تاريخ النهاية قبل البداية" };

  const annual = sarToHalalas(String(formData.get("annual_rent") ?? ""));
  if (annual == null || annual < 0) return { error: "أدخل الإيجار السنوي" };

  const contract_kind = String(formData.get("contract_kind") ?? "residential");
  const payment_frequency = String(formData.get("payment_frequency") ?? "quarterly");
  const deposit = sarToHalalas(String(formData.get("deposit") ?? "")) ?? 0;
  const service_fees = sarToHalalas(String(formData.get("service_fees") ?? "")) ?? 0;
  const deed_number = String(formData.get("deed_number") ?? "").trim() || null;
  // contract_number is NOT taken from the form: migration 0045 assigns CT-YYYY-NNNNN atomically in
  // the DB, so every contract is numbered by the same gapless per-(org, year) sequence.

  // Commercial details (per contract): the brand the shop trades under + who signed.
  const trade_name_id = String(formData.get("trade_name_id") ?? "").trim() || null;
  const representative_name = String(formData.get("representative_name") ?? "").trim() || null;
  const representative_capacity = String(formData.get("representative_capacity") ?? "").trim() || null;
  const representative_id = String(formData.get("representative_id") ?? "").trim() || null;
  const representative_phone = String(formData.get("representative_phone") ?? "").trim() || null;

  // Optional منصة إيجار alignment block (presentation only — never drives logic).
  const ejar_contract_number = String(formData.get("ejar_contract_number") ?? "").trim() || null;
  const ejar_broker_office = String(formData.get("ejar_broker_office") ?? "").trim() || null;
  const ejar_broker_number = String(formData.get("ejar_broker_number") ?? "").trim() || null;
  const ejar_broker_representative = String(formData.get("ejar_broker_representative") ?? "").trim() || null;
  const ejarExtra = String(formData.get("ejar_has_extra_terms") ?? "").trim();
  const ejar_has_extra_terms = ejarExtra === "yes" ? true : ejarExtra === "no" ? false : null;

  const supabase = await createClient();

  const { data: unit, error: unitErr } = await supabase
    .from("unit")
    .select("property_id")
    .eq("id", unit_id)
    .maybeSingle();
  if (unitErr) return { error: unitErr.message };
  if (!unit) return { error: "الوحدة غير موجودة" };

  // The contract keeps its own copy of the name: the catalogue entry may later be renamed or
  // retired, and a signed contract must still read the way it was signed.
  let trade_name: string | null = null;
  if (trade_name_id) {
    const { data: brand } = await supabase.from("trade_name").select("name").eq("id", trade_name_id).maybeSingle();
    trade_name = brand?.name ?? null;
  }

  const { data: created, error } = await supabase
    .from("contract")
    .insert({
      org_id: activeOrg,
      property_id: unit.property_id,
      unit_id,
      tenant_id,
      deed_number,
      contract_kind,
      status: "draft",
      start_date,
      end_date,
      annual_rent_halalas: annual,
      payment_frequency,
      deposit_halalas: deposit,
      service_fees_halalas: service_fees,
      trade_name,
      trade_name_id,
      representative_name,
      representative_capacity,
      representative_id,
      representative_phone,
      ejar_contract_number,
      ejar_broker_office,
      ejar_broker_number,
      ejar_broker_representative,
      ejar_has_extra_terms,
    })
    .select("id")
    .single();

  if (error) {
    if (/contract_number/i.test(error.message)) return { error: "تعذّر توليد رقم العقد. أعد المحاولة." };
    return { error: translateSubscriptionError(error.message) ?? error.message };
  }

  redirect(`/app/contracts/${created.id}`);
}

// The contract lifecycle answers where it was asked.
//
// Every action below used to redirect to `?error=…`, which reloaded the detail page and threw away
// what had been typed. On this page that cost is the highest in the product: the same forms carry a
// rent amendment, an early termination, and a payment amount. So each action returns a FormState —
// the message names its field, and the attempt is handed back.

// The fields a refused draft edit must not lose. Read once, echoed once.
const DRAFT_FIELDS = [
  "unit_id", "tenant_id", "contract_kind", "payment_frequency", "start_date", "end_date",
  "annual_rent", "deposit", "service_fees", "deed_number", "trade_name", "representative_name",
  "representative_capacity", "representative_id", "representative_phone", "ejar_contract_number",
  "ejar_broker_office", "ejar_broker_number", "ejar_broker_representative", "ejar_has_extra_terms",
] as const;

const draftValues = (formData: FormData): Record<string, string | null> =>
  Object.fromEntries(DRAFT_FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));

// Edit a DRAFT contract. The update is scoped to status='draft' (0 rows otherwise), so an active
// contract stays immutable exactly as tg_contract_immutable enforces at the DB. RLS (manage_data) gates it.
export async function updateDraftContract(_prev: FormState, formData: FormData): Promise<FormState> {
  const contract_id = String(formData.get("contract_id") ?? "");
  if (!contract_id) return { error: "عقد غير معروف" };
  const values = draftValues(formData);
  const bad = (error: string, field?: string): FormState => ({ error, field, values });

  const unit_id = String(formData.get("unit_id") ?? "");
  const tenant_id = String(formData.get("tenant_id") ?? "");
  const start_date = String(formData.get("start_date") ?? "");
  const end_date = String(formData.get("end_date") ?? "");
  if (!unit_id) return bad("اختر الوحدة", "unit_id");
  if (!tenant_id) return bad("اختر المستأجر", "tenant_id");
  if (!start_date) return bad("حدّد تاريخ البداية", "start_date");
  if (!end_date) return bad("حدّد تاريخ النهاية", "end_date");
  if (end_date < start_date) return bad("تاريخ النهاية قبل البداية", "end_date");
  const annual = sarToHalalas(String(formData.get("annual_rent") ?? ""));
  if (annual == null || annual < 0) return bad("أدخل الإيجار السنوي", "annual_rent");

  const supabase = await createClient();
  const { data: unit } = await supabase.from("unit").select("property_id").eq("id", unit_id).maybeSingle();
  if (!unit) return bad("الوحدة غير موجودة", "unit_id");

  // trade_name and trade_name_id are one fact in two columns, and this form only carries the first.
  // createContract picks the name out of the tenant's catalogue and stores both; editing typed over
  // the name and left the id pointing at whatever was chosen before — so the contract read "مطعم أ"
  // while its link still said "مطعم ب".
  //
  // A hand-typed name has no catalogue entry behind it, so the link goes when the name changes. Only
  // when it changes: this form posts every field on every save, and clearing the link because the
  // office corrected the rent would be losing data it never touched.
  const typedTradeName = String(formData.get("trade_name") ?? "").trim() || null;
  const { data: stored } = await supabase
    .from("contract")
    .select("trade_name")
    .eq("id", contract_id)
    .maybeSingle();
  const tradeNameChanged = (stored?.trade_name ?? null) !== typedTradeName;

  // contract_number is system-assigned (0045) and never edited by hand.
  const ejarExtra = String(formData.get("ejar_has_extra_terms") ?? "").trim();
  const { error, data } = await supabase
    .from("contract")
    .update({
      unit_id,
      tenant_id,
      property_id: unit.property_id,
      contract_kind: String(formData.get("contract_kind") ?? "residential"),
      payment_frequency: String(formData.get("payment_frequency") ?? "quarterly"),
      start_date,
      end_date,
      annual_rent_halalas: annual,
      deposit_halalas: sarToHalalas(String(formData.get("deposit") ?? "")) ?? 0,
      service_fees_halalas: sarToHalalas(String(formData.get("service_fees") ?? "")) ?? 0,
      deed_number: String(formData.get("deed_number") ?? "").trim() || null,
      trade_name: typedTradeName,
      ...(tradeNameChanged ? { trade_name_id: null } : {}),
      representative_name: String(formData.get("representative_name") ?? "").trim() || null,
      representative_capacity: String(formData.get("representative_capacity") ?? "").trim() || null,
      representative_id: String(formData.get("representative_id") ?? "").trim() || null,
      representative_phone: String(formData.get("representative_phone") ?? "").trim() || null,
      ejar_contract_number: String(formData.get("ejar_contract_number") ?? "").trim() || null,
      ejar_broker_office: String(formData.get("ejar_broker_office") ?? "").trim() || null,
      ejar_broker_number: String(formData.get("ejar_broker_number") ?? "").trim() || null,
      ejar_broker_representative: String(formData.get("ejar_broker_representative") ?? "").trim() || null,
      ejar_has_extra_terms: ejarExtra === "yes" ? true : ejarExtra === "no" ? false : null,
    })
    .eq("id", contract_id)
    .eq("status", "draft")
    .select("id");
  if (error) {
    const msg = /contract_number|duplicate key/i.test(error.message) ? "رقم العقد مستخدم بالفعل" : error.message;
    return bad(msg);
  }
  // Zero rows is not an error at the database: the status='draft' filter simply matched nothing,
  // which means the contract was activated while this form was open.
  if (!data || data.length === 0) return bad("لا يمكن تعديل عقد بعد تفعيله");
  revalidatePath(`/app/contracts/${contract_id}`);
  return { ok: "حُفظت تعديلات المسودة." };
}

// Activation has no field of its own, so both outcomes are toasts beside the button that was
// pressed — and the page underneath refreshes into its activated shape.
export async function activateContract(_prev: FormState, formData: FormData): Promise<FormState> {
  const contract_id = String(formData.get("contract_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_contract", { p_contract: contract_id });
  if (error) return { error: error.message };
  revalidatePath(`/app/contracts/${contract_id}`);
  return { ok: "فُعِّل العقد وتولّد جدول الاستحقاقات." };
}

export async function issueInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const charge_id = String(formData.get("charge_id") ?? "");
  if (!charge_id) return { error: "استحقاق غير صالح" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_invoice", { p_charge: charge_id });
  if (error) {
    const msg = /ALREADY_INVOICED/i.test(error.message)
      ? "توجد فاتورة لهذا الاستحقاق بالفعل"
      : error.message;
    return { error: msg };
  }
  // The issued invoice is a destination, not a message: the office goes to read it.
  redirect(`/app/invoices/${data}`);
}

const AMEND_ERRORS: Array<[RegExp, string]> = [
  [/CONTRACT_NOT_ACTIVE/i, "لا يمكن تعديل عقد غير نشط"],
  [/REASON_REQUIRED/i, "السبب مطلوب"],
  [/INVALID_AMOUNT/i, "أدخل مبلغاً صحيحاً"],
];
const amendError = (m: string) => AMEND_ERRORS.find(([re]) => re.test(m))?.[1] ?? m;

// A rent amendment is written in three fields — an amount, a date, and a sentence the office composes
// in its own words. Losing that sentence to a redirect is the whole reason this campaign exists.
export async function amendRent(_prev: FormState, formData: FormData): Promise<FormState> {
  const contract_id = String(formData.get("contract_id") ?? "");
  const newAnnualRaw = String(formData.get("new_annual") ?? "");
  const effective = String(formData.get("effective_date") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const values = { new_annual: newAnnualRaw, effective_date: effective, reason };
  const bad = (error: string, field?: string): FormState => ({ error, field, values });
  if (!contract_id) return bad("عقد غير معروف");

  const newAnnual = sarToHalalas(newAnnualRaw);
  if (newAnnual == null || newAnnual < 0) return bad("أدخل الإيجار السنوي الجديد", "new_annual");
  if (!effective) return bad("حدّد تاريخ سريان التعديل", "effective_date");
  if (!reason) return bad("اكتب سبب التعديل", "reason");

  const supabase = await createClient();
  const { error } = await supabase.rpc("amend_contract_rent", {
    p_contract: contract_id,
    p_new_annual: newAnnual,
    p_effective: effective,
    p_reason: reason,
  });
  if (error) return bad(amendError(error.message));
  revalidatePath(`/app/contracts/${contract_id}`);
  return { ok: "سُجِّل ملحق تعديل الإيجار وأُعيد تسعير الاستحقاقات المستقبلية." };
}

export async function terminateContract(_prev: FormState, formData: FormData): Promise<FormState> {
  const contract_id = String(formData.get("contract_id") ?? "");
  const effective = String(formData.get("effective_date") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const values = { effective_date: effective, reason };
  const bad = (error: string, field?: string): FormState => ({ error, field, values });
  if (!contract_id) return bad("عقد غير معروف");
  if (!effective) return bad("حدّد تاريخ الإنهاء", "effective_date");
  if (!reason) return bad("اكتب سبب الإنهاء", "reason");

  const supabase = await createClient();
  const { error } = await supabase.rpc("amend_contract_terminate", {
    p_contract: contract_id,
    p_effective: effective,
    p_reason: reason,
  });
  if (error) return bad(amendError(error.message));
  revalidatePath(`/app/contracts/${contract_id}`);
  return { ok: "أُنهي العقد وأُلغيت الاستحقاقات المستقبلية غير المدفوعة." };
}

const RENEW_ERRORS: Array<[RegExp, string]> = [
  [/ALREADY_RENEWED/i, "لهذا العقد تجديد قائم بالفعل"],
  [/CONTRACT_NOT_RENEWABLE/i, "يمكن تجديد العقود النشطة أو المنتهية فقط"],
  [/END_BEFORE_START/i, "تاريخ النهاية قبل البداية"],
  [/INVALID_AMOUNT/i, "أدخل الإيجار السنوي الجديد"],
  [/contract_number|duplicate key/i, "رقم العقد مستخدم بالفعل"],
];
const renewError = (m: string) => RENEW_ERRORS.find(([re]) => re.test(m))?.[1] ?? m;

export async function renewContract(_prev: FormState, formData: FormData): Promise<FormState> {
  const source_id = String(formData.get("contract_id") ?? "");
  const start = String(formData.get("start_date") ?? "").trim();
  const end = String(formData.get("end_date") ?? "").trim();
  const newAnnualRaw = String(formData.get("new_annual") ?? "");
  const values = { start_date: start, end_date: end, new_annual: newAnnualRaw };
  const bad = (error: string, field?: string): FormState => ({ error, field, values });
  if (!source_id) return bad("عقد غير معروف");
  if (!start) return bad("حدّد تاريخ البداية", "start_date");
  if (!end) return bad("حدّد تاريخ النهاية", "end_date");
  if (end < start) return bad("تاريخ النهاية قبل البداية", "end_date");
  const newAnnual = sarToHalalas(newAnnualRaw);
  if (newAnnual == null || newAnnual < 0) return bad("أدخل الإيجار السنوي الجديد", "new_annual");

  const supabase = await createClient();
  // p_number is left to its default. It was being passed from a `contract_number` field that exists
  // in no form in the product, so it was always null — and offering it at all would contradict 0045,
  // which assigns CT-YYYY-NNNNN from one gapless per-(org, year) sequence precisely so that no hand
  // can choose a number.
  const { data, error } = await supabase.rpc("renew_contract", {
    p_source: source_id,
    p_start: start,
    p_end: end,
    p_new_annual: newAnnual,
  });
  if (error) return bad(translateSubscriptionError(error.message) ?? renewError(error.message));
  // The renewal draft is a destination: it was created to be reviewed, so we open it.
  redirect(`/app/contracts/${data}`);
}

export async function activateRenewal(_prev: FormState, formData: FormData): Promise<FormState> {
  const contract_id = String(formData.get("contract_id") ?? "");
  if (!contract_id) return { error: "عقد غير معروف" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_renewal", { p_new: contract_id });
  if (error) return { error: renewError(error.message) };
  revalidatePath(`/app/contracts/${contract_id}`);
  return { ok: "فُعِّل التجديد وأُنهي العقد السابق." };
}

export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const contract_id = String(formData.get("contract_id") ?? "");
  const charge_id = String(formData.get("charge_id") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const method = String(formData.get("method") ?? "cash");
  const values = { amount: amountRaw };
  if (!charge_id) return { error: "استحقاق غير صالح", values };
  const amount = sarToHalalas(amountRaw);
  if (amount == null || amount <= 0) return { error: "أدخل مبلغاً صحيحاً", field: "amount", values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_charge_payment", {
    p_charge: charge_id,
    p_amount_halalas: amount,
    p_method: method,
  });
  if (error) return { error: error.message, values };
  revalidatePath(`/app/contracts/${contract_id}`);
  return { ok: "سُجِّلت الدفعة." };
}
