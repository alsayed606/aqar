"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { sarToHalalas } from "@/lib/money";

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
  let contract_number = String(formData.get("contract_number") ?? "").trim();
  if (!contract_number) contract_number = "CT-" + Date.now();

  const supabase = await createClient();

  const { data: unit, error: unitErr } = await supabase
    .from("unit")
    .select("property_id")
    .eq("id", unit_id)
    .maybeSingle();
  if (unitErr) return { error: unitErr.message };
  if (!unit) return { error: "الوحدة غير موجودة" };

  const { data: created, error } = await supabase
    .from("contract")
    .insert({
      org_id: activeOrg,
      property_id: unit.property_id,
      unit_id,
      tenant_id,
      contract_number,
      deed_number,
      contract_kind,
      status: "draft",
      start_date,
      end_date,
      annual_rent_halalas: annual,
      payment_frequency,
      deposit_halalas: deposit,
      service_fees_halalas: service_fees,
    })
    .select("id")
    .single();

  if (error) {
    if (/contract_number/i.test(error.message)) return { error: "رقم العقد مستخدم بالفعل" };
    return { error: error.message };
  }

  redirect(`/app/contracts/${created.id}`);
}

// Plain form actions (button / small form) — surface errors via ?error= on the detail page.
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
  if (error) redirect(`/app/contracts/${source_id}?error=${encodeURIComponent(renewError(error.message))}`);
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
