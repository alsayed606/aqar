"use client";

import { useActionState } from "react";
import { requestDeletion, type PrivacyState } from "@/app/app/privacy/actions";

const initial: PrivacyState = {};

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(requestDeletion, initial);

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="reason">
          سبب الحذف <span className="font-normal text-neutral-400">(اختياري)</span>
        </label>
        <input id="reason" name="reason" className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="confirm">
          اكتب كلمة <b>حذف</b> للتأكيد
        </label>
        {/* Typed confirmation, not a checkbox: a click is too cheap for an action this size. */}
        <input id="confirm" name="confirm" required autoComplete="off" className={inputCls} />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          {state.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? "جارٍ الإرسال…" : "طلب حذف الحساب"}
      </button>
    </form>
  );
}
