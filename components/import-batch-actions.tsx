"use client";

import { useActionState } from "react";
import { useResultToast } from "@/components/form-field";
import { ConfirmButton } from "@/components/confirm-button";
import type { FormState } from "@/lib/form-state";
import { commitImport, revertImport } from "@/app/app/import/actions";

// The two decisions on an import batch. Both change the page they sit on, so they speak in a toast
// and let the batch refresh underneath.

const initial: FormState = {};

export function CommitImportButton({ batchId, validRows }: { batchId: string; validRows: number }) {
  const [state, action, pending] = useActionState(commitImport, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="batch_id" value={batchId} />
      <button
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {pending ? "جارٍ الاعتماد…" : `اعتماد الصفوف الصحيحة (${validRows})`}
      </button>
    </form>
  );
}

/** Reverting deletes what the batch created, so it keeps a confirmation — and asks why. */
export function RevertImportButton({ batchId }: { batchId: string }) {
  const [state, action] = useActionState(revertImport, initial);
  useResultToast(state);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="batch_id" value={batchId} />
      {/* Required, and stored on the revert itself: this is the record of why real rows were
          deleted, and it used to be the same four characters every time. */}
      <div>
        <input
          name="reason"
          placeholder="سبب التراجع (مطلوب)"
          aria-label="سبب التراجع"
          defaultValue={state.values?.reason ?? ""}
          className={
            "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none sm:w-80 " +
            (state.field === "reason"
              ? "border-red-400 dark:border-red-500"
              : "border-neutral-300 focus:border-brand dark:border-neutral-700")
          }
        />
        {state.field === "reason" && state.error && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
        )}
      </div>
      <ConfirmButton
        message="التراجع يحذف كل السجلات التي أنشأتها هذه الدفعة. هل تريد المتابعة؟"
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
      >
        التراجع عن الدفعة
      </ConfirmButton>
    </form>
  );
}
