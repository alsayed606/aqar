"use client";

import { useActionState } from "react";
import { FormError, fieldCls } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { erasePartyData } from "@/app/app/privacy/actions";

// PDPL erasure of one data subject, run by the office.
//
// Its success is NOT a toast. The answer says how many tax invoices had to be kept by law, and that
// sentence is what the office repeats to the person who asked to be erased — so it stays on the page
// instead of fading after three seconds.

const initial: FormState = {};
const cls = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

export function ErasePartyForm({ tenantId, partyId }: { tenantId: string; partyId: string }) {
  const [state, action, pending] = useActionState(erasePartyData, initial);

  if (state.ok) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
        {state.ok}
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="party_id" value={partyId} />
      <input
        name="reason"
        placeholder="سبب الطلب (اختياري)"
        defaultValue={state.values?.reason ?? ""}
        aria-label="سبب طلب الحذف"
        className={cls + " sm:col-span-2"}
      />
      <div>
        <input
          name="confirm"
          required
          autoComplete="off"
          placeholder="اكتب: حذف"
          aria-label="تأكيد الحذف"
          className={state.field === "confirm" ? fieldCls(state, "confirm") : cls}
        />
        {state.field === "confirm" && state.error && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
        )}
      </div>
      <div className="sm:col-span-3 space-y-2">
        <FormError state={state} />
        <button
          disabled={pending}
          className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-60 sm:w-auto"
        >
          {pending ? "جارٍ الحذف…" : "حذف البيانات الشخصية"}
        </button>
      </div>
    </form>
  );
}
