"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { sarToHalalas } from "@/lib/money";
import { translateSubscriptionError } from "@/lib/subscription-errors";

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

// Plain form actions (button / small form) — surface errors via ?error= on the detail page.
// Edit a DRAFT contract. The update is scoped to status='draft' (0 rows otherwise), so an active
// contract stays immutable exactly as tg_contract_immutable enforces at the DB. RLS (manage_data) gates it.
export async function updateDraftContract(formData: FormData) {
  const contract_id = String(formData.get("contract_id") ?? "");
  if (!contract_id) redirect("/app/contracts");
  const back = `/app/contracts/${contract_id}`;

  const unit_id = String(formData.get("unit_id") ?? "");
  const tenant_id = String(formData.get("tenant_id") ?? "");
  const start_date = String(formData.get("start_date") ?? "");
  const end_date = String(formData.get("end_date") ?? "");
  if (!unit_id || !tenant_id) redirect(`${back}?error=${encodeURIComponent("اختر الوحدة والمستأجر")}`);
  if (!start_date || !end_date) redirect(`${back}?error=${encodeURIComponent("حدّد التواريخ")}`);
  if (end_date < start_date) redirect(`${back}?error=${encodeURIComponent("تاريخ النهاية قبل البداية")}`);
  const annual = sarToHalalas(String(formData.get("annual_rent") ?? ""));
  if (annual == null || annual < 0) redirect(`${back}?error=${encodeURIComponent("أدخل الإيجار السنوي")}`);

  const supabase = await createClient();
  const { data: unit } = await supabase.from("unit").select("property_id").eq("id", unit_id).maybeSingle();
  if (!unit) redirect(`${back}?error=${encodeURIComponent("الوحدة غير موجودة")}`);

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
      trade_name: String(formData.get("trade_name") ?? "").trim() || null,
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
    redirect(`${back}?error=${encodeURIComponent(msg)}`);
  }
  if (!data || data.length === 0) redirect(`${back}?error=${encodeURIComponent("لا يمكن تعديل عقد بعد تفعيله")}`);
  revalidatePath(back);
  redirect(back);
}

export async function activateContract(formData: FormData) {
  const contract_id = String(formData.get("contract_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_contract", { p_contract: contract_id });
  if (error) {
    redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/contracts/${contract_id}`);
  redirect(`/app/contracts/${contract_id}`);
}

export async function issueInvoice(formData: FormData) {
  const contract_id = String(formData.get("contract_id") ?? "");
  const charge_id = String(formData.get("charge_id") ?? "");
  if (!charge_id) {
    redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent("استحقاق غير صالح")}`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_invoice", { p_charge: charge_id });
  if (error) {
    const msg = /ALREADY_INVOICED/i.test(error.message)
      ? "توجد فاتورة لهذا الاستحقاق بالفعل"
      : error.message;
    redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/app/invoices/${data}`);
}

const AMEND_ERRORS: Array<[RegExp, string]> = [
  [/CONTRACT_NOT_ACTIVE/i, "لا يمكن تعديل عقد غير نشط"],
  [/REASON_REQUIRED/i, "السبب مطلوب"],
  [/INVALID_AMOUNT/i, "أدخل مبلغاً صحيحاً"],
];
const amendError = (m: string) => AMEND_ERRORS.find(([re]) => re.test(m))?.[1] ?? m;

export async function amendRent(formData: FormData) {
  const contract_id = String(formData.get("contract_id") ?? "");
  const newAnnual = sarToHalalas(String(formData.get("new_annual") ?? ""));
  const effective = String(formData.get("effective_date") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!contract_id) redirect("/app/contracts");
  if (newAnnual == null || newAnnual < 0) {
    redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent("أدخل الإيجار السنوي الجديد")}`);
  }
  if (!effective) redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent("حدّد تاريخ سريان التعديل")}`);
  if (!reason) redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent("اكتب سبب التعديل")}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("amend_contract_rent", {
    p_contract: contract_id,
    p_new_annual: newAnnual,
    p_effective: effective,
    p_reason: reason,
  });
  if (error) redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent(amendError(error.message))}`);
  revalidatePath(`/app/contracts/${contract_id}`);
  redirect(`/app/contracts/${contract_id}`);
}

export async function terminateContract(formData: FormData) {
  const contract_id = String(formData.get("contract_id") ?? "");
  const effective = String(formData.get("effective_date") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!contract_id) redirect("/app/contracts");
  if (!effective) redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent("حدّد تاريخ الإنهاء")}`);
  if (!reason) redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent("اكتب سبب الإنهاء")}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("amend_contract_terminate", {
    p_contract: contract_id,
    p_effective: effective,
    p_reason: reason,
  });
  if (error) redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent(amendError(error.message))}`);
  revalidatePath(`/app/contracts/${contract_id}`);
  redirect(`/app/contracts/${contract_id}`);
}

const RENEW_ERRORS: Array<[RegExp, string]> = [
  [/ALREADY_RENEWED/i, "لهذا العقد تجديد قائم بالفعل"],
  [/CONTRACT_NOT_RENEWABLE/i, "يمكن تجديد العقود النشطة أو المنتهية فقط"],
  [/END_BEFORE_START/i, "تاريخ النهاية قبل البداية"],
  [/INVALID_AMOUNT/i, "أدخل الإيجار السنوي الجديد"],
  [/contract_number|duplicate key/i, "رقم العقد مستخدم بالفعل"],
];
const renewError = (m: string) => RENEW_ERRORS.find(([re]) => re.test(m))?.[1] ?? m;

export async function renewContract(formData: FormData) {
  const source_id = String(formData.get("contract_id") ?? "");
  const start = String(formData.get("start_date") ?? "").trim();
  const end = String(formData.get("end_date") ?? "").trim();
  const newAnnual = sarToHalalas(String(formData.get("new_annual") ?? ""));
  const number = String(formData.get("contract_number") ?? "").trim() || null;
  if (!source_id) redirect("/app/contracts");
  if (!start || !end) redirect(`/app/contracts/${source_id}?error=${encodeURIComponent("حدّد تاريخي البداية والنهاية")}`);
  if (end < start) redirect(`/app/contracts/${source_id}?error=${encodeURIComponent("تاريخ النهاية قبل البداية")}`);
  if (newAnnual == null || newAnnual < 0) redirect(`/app/contracts/${source_id}?error=${encodeURIComponent("أدخل الإيجار السنوي الجديد")}`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renew_contract", {
    p_source: source_id,
    p_start: start,
    p_end: end,
    p_new_annual: newAnnual,
    p_number: number,
  });
  if (error) {
    const msg = translateSubscriptionError(error.message) ?? renewError(error.message);
    redirect(`/app/contracts/${source_id}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/app/contracts/${data}`);
}

export async function activateRenewal(formData: FormData) {
  const contract_id = String(formData.get("contract_id") ?? "");
  if (!contract_id) redirect("/app/contracts");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_renewal", { p_new: contract_id });
  if (error) redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent(renewError(error.message))}`);
  revalidatePath(`/app/contracts/${contract_id}`);
  redirect(`/app/contracts/${contract_id}`);
}

export async function recordPayment(formData: FormData) {
  const contract_id = String(formData.get("contract_id") ?? "");
  const charge_id = String(formData.get("charge_id") ?? "");
  const amount = sarToHalalas(String(formData.get("amount") ?? ""));
  const method = String(formData.get("method") ?? "cash");
  if (!charge_id || amount == null || amount <= 0) {
    redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent("أدخل مبلغاً صحيحاً")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_charge_payment", {
    p_charge: charge_id,
    p_amount_halalas: amount,
    p_method: method,
  });
  if (error) {
    redirect(`/app/contracts/${contract_id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/contracts/${contract_id}`);
  redirect(`/app/contracts/${contract_id}`);
}
