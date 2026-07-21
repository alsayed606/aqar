"use client";

import { useActionState } from "react";
import { startImport, type ImportState } from "@/app/app/import/actions";
import { IMPORT_KINDS, KIND_LABEL } from "@/lib/import-headers";

const initial: ImportState = {};

export function ImportForm() {
  const [state, action, pending] = useActionState(startImport, initial);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="kind">
          نوع البيانات
        </label>
        <select
          id="kind"
          name="kind"
          defaultValue="properties"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          {IMPORT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="file">
          ملف Excel (.xlsx)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none file:mr-2 file:rounded file:border-0 file:bg-neutral-100 file:px-3 file:py-1 dark:border-neutral-700 dark:file:bg-neutral-800"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ الرفع والتحقق…" : "رفع وتحقّق"}
        </button>
      </div>
    </form>
  );
}
