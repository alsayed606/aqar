"use client";

import { useActionState, useEffect, useRef } from "react";
import { createProperty, type PropState } from "@/app/app/properties/actions";
import { PROPERTY_KIND_AR } from "@/lib/labels";

const initial: PropState = {};

type OwnerOption = { id: string; label: string };

export function PropertyForm({ owners = [] }: { owners?: OwnerOption[] }) {
  const [state, action, pending] = useActionState(createProperty, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium" htmlFor="name">
          اسم العقار *
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="مثال: برج الياسمين"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      {owners.length > 0 && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium" htmlFor="owner_id">
            المالك
          </label>
          <select
            id="owner_id"
            name="owner_id"
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
          >
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="property_kind">
          النوع
        </label>
        <select
          id="property_kind"
          name="property_kind"
          defaultValue="residential"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          {Object.entries(PROPERTY_KIND_AR).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="deed_number">
          رقم الصك
        </label>
        <input
          id="deed_number"
          name="deed_number"
          dir="ltr"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="city">
          المدينة
        </label>
        <input
          id="city"
          name="city"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="district">
          الحي
        </label>
        <input
          id="district"
          name="district"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
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
          {pending ? "جارٍ الحفظ…" : "إضافة العقار"}
        </button>
      </div>
    </form>
  );
}
