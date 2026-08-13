"use client";

import { useActionState } from "react";
import { Field, FormError, fieldCls, useResultToast, useSuccessToast } from "@/components/form-field";
import { TenantFields, type TenantDefaults } from "@/components/tenant-fields";
import type { FormState } from "@/lib/form-state";
import { addTradeName, removeTradeName, updateTenant } from "@/app/app/tenants/actions";

// The forms on a tenant's page. The edit drawer alone holds sixteen inputs, so a refusal that
// re-rendered it from the stored row would ask the office to retype a record to fix one digit —
// which is why every refusal carries the typed values back and they become the defaults.

const initial: FormState = {};

export function TenantEditForm({
  tenantId,
  partyId,
  defaults,
}: {
  tenantId: string;
  partyId: string;
  defaults: TenantDefaults;
}) {
  const [state, action, pending] = useActionState(updateTenant, initial);
  useSuccessToast(state);

  // The attempt wins over the stored row whenever there was one.
  const shown = { ...defaults, ...(state.values ?? {}) } as TenantDefaults;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="party_id" value={partyId} />
      <TenantFields defaults={shown} />
      <FormError state={state} />
      {state.field && state.error && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
      )}
      <button
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {pending ? "جارٍ الحفظ…" : "حفظ التعديلات"}
      </button>
    </form>
  );
}

export function AddTradeNameForm({ tenantId, partyId }: { tenantId: string; partyId: string }) {
  const [state, action, pending] = useActionState(addTradeName, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="grid gap-3 border-t border-neutral-100 pt-3 sm:grid-cols-3 dark:border-neutral-800">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="party_id" value={partyId} />
      <Field label="الاسم التجاري" name="name" state={state}>
        <input
          id="name"
          name="name"
          defaultValue={state.values?.name ?? ""}
          className={fieldCls(state, "name")}
        />
      </Field>
      <Field label="رقم الرخصة البلدية" name="municipal_license_no" state={state}>
        <input
          id="municipal_license_no"
          name="municipal_license_no"
          dir="ltr"
          defaultValue={state.values?.municipal_license_no ?? ""}
          className={fieldCls(state, "municipal_license_no") + " text-start"}
        />
      </Field>
      <Field label="انتهاء الرخصة" name="license_expiry" state={state}>
        <input
          id="license_expiry"
          name="license_expiry"
          type="date"
          defaultValue={state.values?.license_expiry ?? ""}
          className={fieldCls(state, "license_expiry")}
        />
      </Field>
      <div className="sm:col-span-3 space-y-2">
        <FormError state={state} />
        <button
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {pending ? "جارٍ الإضافة…" : "إضافة اسم تجاري"}
        </button>
      </div>
    </form>
  );
}

export function RemoveTradeNameButton({
  tenantId,
  tradeNameId,
}: {
  tenantId: string;
  tradeNameId: string;
}) {
  const [state, action, pending] = useActionState(removeTradeName, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="trade_name_id" value={tradeNameId} />
      <button disabled={pending} className="text-xs text-red-600 hover:underline disabled:opacity-60">
        {pending ? "…" : "إزالة"}
      </button>
    </form>
  );
}
