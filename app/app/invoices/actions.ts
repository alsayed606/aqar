"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sarToHalalas } from "@/lib/money";

function noteError(invoiceId: string, message: string): never {
  redirect(`/app/invoices/${invoiceId}?error=${encodeURIComponent(message)}`);
}

const AR_ERRORS: Array<[RegExp, string]> = [
  [/REASON_REQUIRED/i, "السبب مطلوب"],
  [/INVOICE_NOT_ISSUED/i, "الفاتورة ملغاة بالفعل"],
  [/NOT_AN_INVOICE/i, "لا يمكن إصدار إشعار على إشعار آخر"],
  [/INVALID_AMOUNT/i, "أدخل مبلغاً صحيحاً"],
];
const toAr = (m: string) => AR_ERRORS.find(([re]) => re.test(m))?.[1] ?? m;

export async function issueCreditNote(formData: FormData) {
  const invoice_id = String(formData.get("invoice_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoice_id) redirect("/app/invoices");
  if (!reason) noteError(invoice_id, "اكتب سبب الإشعار الدائن");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_credit_note", {
    p_invoice: invoice_id,
    p_reason: reason,
  });
  if (error) noteError(invoice_id, toAr(error.message));
  redirect(`/app/invoices/${data}`);
}

export async function issueDebitNote(formData: FormData) {
  const invoice_id = String(formData.get("invoice_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const amount = sarToHalalas(String(formData.get("amount") ?? ""));
  if (!invoice_id) redirect("/app/invoices");
  if (!reason) noteError(invoice_id, "اكتب سبب الإشعار المدين");
  if (amount == null || amount <= 0) noteError(invoice_id, "أدخل مبلغاً صحيحاً");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_debit_note", {
    p_invoice: invoice_id,
    p_reason: reason,
    p_desc: description || "مبلغ إضافي",
    p_amount_excl: amount,
    p_vat_rate: null,
  });
  if (error) noteError(invoice_id, toAr(error.message));
  redirect(`/app/invoices/${data}`);
}
