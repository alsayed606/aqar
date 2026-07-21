"use client";

import { useActionState } from "react";
import { createOrg, type OrgState } from "@/app/app/actions";

const initial: OrgState = {};

export function CreateOrgForm() {
  const [state, action, pending] = useActionState(createOrg, initial);

  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="name">
        اسم المنشأة (مكتب إدارة الأملاك / المكتب العقاري)
      </label>
      <input
        id="name"
        name="name"
        placeholder="مثال: مكتب الياسمين لإدارة الأملاك"
        className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        required
      />
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {pending ? "جارٍ الإنشاء…" : "إنشاء المنشأة"}
      </button>
    </form>
  );
}
