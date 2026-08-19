"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui";
import { useSuccessToast } from "@/components/form-field";
import { setMaintenanceStatus, saveMaintenanceAssignment } from "@/app/app/maintenance/actions";
import {
  MAINTENANCE_CATEGORY_AR,
  MAINTENANCE_URGENCY_AR,
  MAINTENANCE_STATUS_AR,
  MAINTENANCE_BEARER_AR,
} from "@/lib/labels";
import { maintenanceStatusTone, maintenanceUrgencyTone, MAINTENANCE_STATUSES } from "@/lib/maintenance";
import type { FormState } from "@/lib/form-state";

// The inspector beside the list: a maintenance request is a job being worked, not a page of its own.
// Everything the office changes about it lives here, next to the description it is changing it for.

export type MaintenanceRow = {
  id: string;
  request_no: string | null;
  status: string;
  urgency: string;
  category: string;
  description: string;
  unit_number: string | null;
  property_name: string | null;
  reporter_name: string | null;
  assignee_name: string | null;
  vendor_name: string | null;
  estimated_cost_halalas: number | null;
  cost_bearer: string | null;
  resolution_note: string | null;
  created_at: string;
};

const initial: FormState = {};
const field = "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700";
const bad = "w-full rounded-lg border border-red-400 bg-transparent px-3 py-2 text-sm outline-none dark:border-red-500";

function FieldError({ state, name }: { state: FormState; name: string }) {
  if (state.field !== name || !state.error) return null;
  return <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>;
}

function FormLevelError({ state }: { state: FormState }) {
  if (!state.error || state.field) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      {state.error}
    </p>
  );
}

function StatusForm({ request }: { request: MaintenanceRow }) {
  const [state, action, pending] = useActionState(setMaintenanceStatus, initial);
  useSuccessToast(state);
  const closing = request.status !== "resolved";

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="request_id" value={request.id} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500" htmlFor="status">الحالة</label>
        <select id="status" name="status" defaultValue={request.status} className={field + " w-auto"}>
          {/* Driven by the same list the action validates against, so the control can never offer a
              status the server refuses. */}
          {MAINTENANCE_STATUSES.map((value) => (
            <option key={value} value={value}>{MAINTENANCE_STATUS_AR[value] ?? value}</option>
          ))}
        </select>
        <button
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : "تحديث الحالة"}
        </button>
      </div>
      <div>
        <input
          name="resolution_note"
          placeholder={closing ? "كيف عولج الطلب؟ (مطلوب عند الإغلاق)" : "ملاحظة الإغلاق"}
          aria-label="ملاحظة المعالجة"
          defaultValue={state.values?.resolution_note ?? request.resolution_note ?? ""}
          className={state.field === "resolution_note" ? bad : field}
        />
        <FieldError state={state} name="resolution_note" />
      </div>
      <FormLevelError state={state} />
    </form>
  );
}

function AssignmentForm({ request }: { request: MaintenanceRow }) {
  const [state, action, pending] = useActionState(saveMaintenanceAssignment, initial);
  useSuccessToast(state);
  const held = (name: string, stored: string | null) => state.values?.[name] ?? stored ?? "";

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="request_id" value={request.id} />
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-slate-500">تعيين إلى</span>
        <input name="assignee_name" placeholder="فني السباكة — عبدالله" defaultValue={held("assignee_name", request.assignee_name)} className={field} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-slate-500">المقاول / المورّد</span>
        <input name="vendor_name" placeholder="شركة الصفا للصيانة" defaultValue={held("vendor_name", request.vendor_name)} className={field} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-slate-500">التكلفة المقدّرة (ر.س)</span>
        <input
          name="estimated_cost"
          inputMode="decimal"
          defaultValue={
            state.values?.estimated_cost ??
            (request.estimated_cost_halalas != null ? String(Number(request.estimated_cost_halalas) / 100) : "")
          }
          className={state.field === "estimated_cost" ? bad : field}
        />
        <FieldError state={state} name="estimated_cost" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-slate-500">من يتحمّل التكلفة</span>
        <select name="cost_bearer" defaultValue={held("cost_bearer", request.cost_bearer)} className={state.field === "cost_bearer" ? bad : field}>
          <option value="">—</option>
          {Object.entries(MAINTENANCE_BEARER_AR).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <FieldError state={state} name="cost_bearer" />
      </label>
      <div className="sm:col-span-2 space-y-2">
        <FormLevelError state={state} />
        <button
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ التعيين"}
        </button>
        {/* Recorded, not posted: nothing here touches the owner statement or the management fee. */}
        <p className="text-xs text-slate-500">من يتحمّل التكلفة يُسجَّل هنا للمرجع — ولا يُخصم تلقائياً من كشف المالك.</p>
      </div>
    </form>
  );
}

export function MaintenanceInspector({ request }: { request: MaintenanceRow }) {
  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold" dir="ltr">{request.request_no ?? "—"}</span>
          <Badge tone={maintenanceUrgencyTone(request.urgency)}>{MAINTENANCE_URGENCY_AR[request.urgency] ?? request.urgency}</Badge>
          <Badge tone={maintenanceStatusTone(request.status)}>{MAINTENANCE_STATUS_AR[request.status] ?? request.status}</Badge>
          <Badge tone="neutral">{MAINTENANCE_CATEGORY_AR[request.category] ?? request.category}</Badge>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {request.property_name ?? "—"} • وحدة {request.unit_number ?? "—"}
          {request.reporter_name && <> — {request.reporter_name}</>}
        </p>
      </div>

      {/* The tenant's own words, not summarised: the office reads them to decide who to send. */}
      <p className="rounded-xl bg-slate-50 p-3 text-sm leading-7 dark:bg-slate-800/50">{request.description}</p>

      <StatusForm request={request} />
      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <AssignmentForm request={request} />
      </div>
    </div>
  );
}
