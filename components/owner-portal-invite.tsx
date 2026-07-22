"use client";

import { useActionState } from "react";
import { createOwnerInvite, type OwnerInviteState } from "@/app/app/owners/actions";

const initial: OwnerInviteState = {};

export function OwnerPortalInvite({ ownerId }: { ownerId: string }) {
  const [state, action, pending] = useActionState(createOwnerInvite, initial);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="owner_id" value={ownerId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {pending ? "جارٍ…" : "إنشاء رابط بوابة المالك"}
        </button>
      </form>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      {state.link && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-900/20">
          <p className="mb-1 font-medium text-emerald-800 dark:text-emerald-300">
            انسخ الرابط وأرسله للمالك ليطّلع على كشوفه وتوريداته (صالح ٣٠ يوماً، يُستخدم مرة واحدة):
          </p>
          <input
            readOnly
            value={state.link}
            dir="ltr"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-xs outline-none dark:border-emerald-800 dark:bg-neutral-900"
          />
        </div>
      )}
    </div>
  );
}
