"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sarToHalalas } from "@/lib/money";
import type { FormState } from "@/lib/form-state";

const AR_ERRORS: Array<[RegExp, string]> = [
  [/REASON_REQUIRED/i, "السبب مطلوب"],
  [/INVOICE_NOT_ISSUED/i, "الفاتورة ملغاة بالفعل"],
  [/NOT_AN_INVOICE/i, "لا يمكن إصدار إشعار على إشعار آخر"],
  [/INVALID_AMOUNT/i, "أدخل مبلغاً صحيحاً"],
];
const toAr = (m: string) => AR_ERRORS.find(([re]) => re.test(m))?.[1] ?? m;

// A refusal keeps the office on the invoice with its reason still typed; success is a navigation to
// the note that was just issued, and that redirect stays — it is a destination, not a message.
export async function issueCreditNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const invoice_id = String(formData.get("invoice_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoice_id) return { error: "فاتورة غير معروفة" };
  if (!reason) return { error: "اكتب سبب الإشعار الدائن", field: "reason", values: { reason } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_credit_note", {
    p_invoice: invoice_id,
    p_reason: reason,
  });
  if (error) return { error: toAr(error.message), values: { reason } };
  redirect(`/app/invoices/${data}`);
}

export async function issueDebitNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const invoice_id = String(formData.get("invoice_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const rawAmount = String(formData.get("amount") ?? "");
  const amount = sarToHalalas(rawAmount);
  const typed = { reason, description, amount: rawAmount };

  if (!invoice_id) return { error: "فاتورة غير معروفة" };
  if (!reason) return { error: "اكتب سبب الإشعار المدين", field: "reason", values: typed };
  if (amount == null || amount <= 0) {
    return { error: "أدخل مبلغاً صحيحاً", field: "amount", values: typed };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_debit_note", {
    p_invoice: invoice_id,
    p_reason: reason,
    p_desc: description || "مبلغ إضافي",
    p_amount_excl: amount,
    p_vat_rate: null,
  });
  if (error) return { error: toAr(error.message), values: typed };
  redirect(`/app/invoices/${data}`);
}
