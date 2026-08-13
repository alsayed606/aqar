"use client";

import { useActionState } from "react";
import { FormError, fieldCls, useSuccessToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { issueCreditNote, issueDebitNote } from "@/app/app/invoices/actions";

// Credit and debit notes. Each carries a reason the office writes in its own words — and a debit
// note carries an amount — so a refusal keeps both and marks the box that caused it. On success the
// action navigates to the note it just issued, which is a destination and not a message.

const initial: FormState = {};

const noteInput = "w-full text-sm";

export function CreditNoteForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(issueCreditNote, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="space-y-2 rounded-xl border border-neutral-100 p-3 dark:border-neutral-800">
      <p className="text-sm font-medium">إشعار دائن (إلغاء الفاتورة)</p>
      <p className="text-xs text-neutral-500">يلغي الفاتورة بالكامل ويحرّر استحقاقها لإعادة الإصدار.</p>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input
        name="reason"
        required
        placeholder="سبب الإلغاء (مثال: خطأ في الإصدار)"
        defaultValue={state.values?.reason ?? ""}
        aria-label="سبب الإشعار الدائن"
        className={noteInput + " " + fieldCls(state, "reason")}
      />
      {state.field === "reason" && state.error && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
      )}
      <FormError state={state} />
      <button
        disabled={pending}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? "جارٍ الإصدار…" : "إصدار إشعار دائن"}
      </button>
    </form>
  );
}

export function DebitNoteForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(issueDebitNote, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="space-y-2 rounded-xl border border-neutral-100 p-3 dark:border-neutral-800">
      <p className="text-sm font-medium">إشعار مدين (إضافة مبلغ)</p>
      <p className="text-xs text-neutral-500">يضيف مبلغاً على الفاتورة (تُطبَّق نسبة ضريبتها).</p>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input
        name="description"
        placeholder="الوصف (مثال: غرامة تأخير)"
        defaultValue={state.values?.description ?? ""}
        aria-label="وصف الإشعار المدين"
        className={noteInput + " " + fieldCls(state, "description")}
      />
      <div className="flex gap-2">
        <input
          name="amount"
          inputMode="decimal"
          placeholder="المبلغ (ر.س، غير شامل)"
          defaultValue={state.values?.amount ?? ""}
          aria-label="مبلغ الإشعار المدين"
          className={"w-40 text-sm " + fieldCls(state, "amount")}
        />
        <input
          name="reason"
          required
          placeholder="السبب"
          defaultValue={state.values?.reason ?? ""}
          aria-label="سبب الإشعار المدين"
          className={"flex-1 text-sm " + fieldCls(state, "reason")}
        />
      </div>
      {state.field && state.error && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
      )}
      <FormError state={state} />
      <button
        disabled={pending}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {pending ? "جارٍ الإصدار…" : "إصدار إشعار مدين"}
      </button>
    </form>
  );
}
