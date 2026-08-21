"use client";

import { useActionState } from "react";
import { submitMaintenanceRequest } from "@/app/portal/maintenance-actions";
import { MAINTENANCE_CATEGORY_AR, MAINTENANCE_URGENCY_AR } from "@/lib/labels";
import type { FormState } from "@/lib/form-state";

// What a tenant fills in to report a fault.
//
// Deliberately four fields. Every extra one is a reason not to report, and an unreported leak costs
// the office more than a badly categorised one.

export type PortalUnit = { unit_id: string; label: string };

const initial: FormState = {};
const field = "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700";
const bad = "w-full rounded-lg border border-red-400 bg-transparent px-3 py-2 text-sm outline-none dark:border-red-500";

export function MaintenanceRequestForm({ tenantId, units }: { tenantId: string; units: PortalUnit[] }) {
  const [state, action, pending] = useActionState(submitMaintenanceRequest, initial);

  if (units.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
        لا يمكن تقديم طلب صيانة إلا على وحدة لك عليها عقد نشط.
      </p>
    );
  }

  if (state.ok) {
    return (
      <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
        {state.ok}
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="tenant_id" value={tenantId} />

      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-slate-500">الوحدة</span>
        <select name="unit_id" defaultValue={state.values?.unit_id ?? units[0].unit_id} className={state.field === "unit_id" ? bad : field}>
          {units.map((u) => (
            <option key={u.unit_id} value={u.unit_id}>{u.label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-slate-500">نوع العطل</span>
        <select name="category" defaultValue={state.values?.category ?? "plumbing"} className={field}>
          {Object.entries(MAINTENANCE_CATEGORY_AR).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-slate-500">درجة الأهمية</span>
        <select name="urgency" defaultValue={state.values?.urgency ?? "normal"} className={field}>
          {Object.entries(MAINTENANCE_URGENCY_AR).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-slate-500">وصف المشكلة</span>
        <textarea
          name="description"
          rows={4}
          required
          placeholder="اشرح ما حدث ومتى بدأ."
          defaultValue={state.values?.description ?? ""}
          className={state.field === "description" ? bad : field}
        />
        {state.field === "description" && state.error && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
        )}
      </label>

      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-slate-500">صورة العطل — اختيارية</span>
        {/* capture="environment" opens the back camera straight away on a phone, which is where this
            screen is read and where the fault is. accept keeps the picker to images on desktop. */}
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm file:me-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm dark:border-slate-700 dark:file:bg-slate-800"
        />
        {/* Said plainly because the tenant is about to photograph their own home: the office sees
            this, and nobody else does. */}
        <span className="mt-1 block text-xs text-slate-500">
          صورةٌ واحدة تغني عن زيارة. يراها المكتب فقط، ولا يراها المالك. الحد ٥ ميغابايت.
        </span>
      </label>

      <div className="sm:col-span-2 space-y-2">
        {state.error && !state.field && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {state.error}
          </p>
        )}
        <button
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ الإرسال…" : "إرسال الطلب"}
        </button>
        {/* Stated, not implied: the office decides urgency in the end, and promising otherwise on
            this screen is a promise the office has to keep at 2am. */}
        <p className="text-xs text-slate-500">الطلب الطارئ يصل المكتب فوراً بالبريد. وللحالات الخطرة اتصل بالمكتب مباشرة.</p>
      </div>
    </form>
  );
}
