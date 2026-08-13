"use client";

import { useActionState } from "react";
import { useResultToast } from "@/components/form-field";
import { ConfirmButton } from "@/components/confirm-button";
import type { FormState } from "@/lib/form-state";
import { commitImport, revertImport } from "@/app/app/import/actions";

// The two decisions on an import batch. Neither has a field, and both change the page they sit on,
// so they speak in a toast and let the batch refresh underneath.

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

/** Reverting deletes what the batch created, so it keeps a confirmation in front of it. */
export function RevertImportButton({ batchId }: { batchId: string }) {
  const [state, action] = useActionState(revertImport, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="batch_id" value={batchId} />
      <ConfirmButton
        message="التراجع يحذف كل السجلات التي أنشأتها هذه الدفعة. هل تريد المتابعة؟"
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
      >
        التراجع عن الدفعة
      </ConfirmButton>
    </form>
  );
}
