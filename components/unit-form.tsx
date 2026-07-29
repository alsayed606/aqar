"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUnit, type UnitState } from "@/app/app/properties/actions";
import { UNIT_STATUS_AR } from "@/lib/labels";
import { Combobox } from "@/components/ui";
import { useFormDrawerClose } from "@/components/form-drawer";

const initial: UnitState = {};

// Either bound to one property (propertyId) or offered with a property picker (properties) — the
// latter powers the standalone /app/units page.
export function UnitForm({
  propertyId,
  properties,
}: {
  propertyId?: string;
  properties?: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(createUnit, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const closeDrawer = useFormDrawerClose();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      closeDrawer?.();
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-3">
      {properties ? (
        <div className="sm:col-span-3">
          <label className="mb-1 block text-sm font-medium">العقار *</label>
          <Combobox
            name="property_id"
            placeholder="ابحث واختر العقار…"
            options={properties.map((p) => ({ value: p.id, label: p.label }))}
          />
        </div>
      ) : (
        <input type="hidden" name="property_id" value={propertyId} />
      )}

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="unit_number">
          رقم الوحدة *
        </label>
        <input
          id="unit_number"
          name="unit_number"
          required
          placeholder="101"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="current_status">
          الحالة
        </label>
        <select
          id="current_status"
          name="current_status"
          defaultValue="vacant"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          {Object.entries(UNIT_STATUS_AR).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="floor">
          الدور
        </label>
        <input
          id="floor"
          name="floor"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="area_sqm">
          المساحة (م²)
        </label>
        <input
          id="area_sqm"
          name="area_sqm"
          inputMode="decimal"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="bedrooms">
          غرف النوم
        </label>
        <input
          id="bedrooms"
          name="bedrooms"
          inputMode="numeric"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="bathrooms">
          دورات المياه
        </label>
        <input
          id="bathrooms"
          name="bathrooms"
          inputMode="numeric"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-3 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="sm:col-span-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : "إضافة الوحدة"}
        </button>
      </div>
    </form>
  );
}
