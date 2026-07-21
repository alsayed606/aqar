"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTenant, type TenantState } from "@/app/app/tenants/actions";

const initial: TenantState = {};

export function TenantForm() {
  const [state, action, pending] = useActionState(createTenant, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium" htmlFor="display_name">
          اسم المستأجر *
        </label>
        <input
          id="display_name"
          name="display_name"
          required
          placeholder="مثال: أحمد الشهري"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="legal_kind">
          النوع
        </label>
        <select
          id="legal_kind"
          name="legal_kind"
          defaultValue="individual"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          <option value="individual">فرد</option>
          <option value="company">شركة</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="national_id">
          رقم الهوية / الإقامة
        </label>
        <input
          id="national_id"
          name="national_id"
          dir="ltr"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="phone">
          الجوال
        </label>
        <input
          id="phone"
          name="phone"
          dir="ltr"
          placeholder="05XXXXXXXX"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="email">
          البريد الإلكتروني
        </label>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700"
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
          {pending ? "جارٍ الحفظ…" : "إضافة المستأجر"}
        </button>
      </div>
    </form>
  );
}
