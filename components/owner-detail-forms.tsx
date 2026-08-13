"use client";

import { useActionState } from "react";
import { Field, FormError, fieldCls, useSuccessToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { recordRemittance, setOwnerFee, setOwnerTaxInfo } from "@/app/app/owners/actions";

// The two small forms on an owner's page. Both hold a number that is easy to mistype and tedious to
// retype — a percentage and a fifteen-digit tax number — so both keep what was typed when refused,
// and both put the refusal under the box that caused it.

const initial: FormState = {};

const smallButton =
  "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800";

export function OwnerFeeForm({ ownerId, currentPct }: { ownerId: string; currentPct: number }) {
  const [state, action, pending] = useActionState(setOwnerFee, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
      <input type="hidden" name="owner_id" value={ownerId} />
      <Field label="نسبة أتعاب الإدارة (% من التحصيل)" name="percent" state={state}>
        <input
          id="percent"
          name="percent"
          inputMode="decimal"
          placeholder="مثال: 5"
          defaultValue={state.values?.percent ?? (currentPct ? String(currentPct) : "")}
          className={"w-28 " + fieldCls(state, "percent")}
        />
      </Field>
      <button disabled={pending} className={smallButton}>
        {pending ? "جارٍ الحفظ…" : "حفظ النسبة"}
      </button>
      <span className="text-xs text-neutral-400">النسبة الحالية: {currentPct}%</span>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}

export function RemittanceForm({
  ownerId,
  periodFrom,
  periodTo,
  suggestedAmount,
  methods,
}: {
  ownerId: string;
  periodFrom: string;
  periodTo: string;
  suggestedAmount: string;
  methods: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(recordRemittance, initial);
  useSuccessToast(state);

  return (
    <form
      action={action}
      className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <input type="hidden" name="owner_id" value={ownerId} />
      <input type="hidden" name="period_from" value={periodFrom} />
      <input type="hidden" name="period_to" value={periodTo} />
      <Field label="المبلغ (ر.س)" name="amount" state={state}>
        <input
          id="amount"
          name="amount"
          inputMode="decimal"
          defaultValue={state.values?.amount ?? suggestedAmount}
          className={"w-32 " + fieldCls(state, "amount")}
        />
      </Field>
      <Field label="الطريقة" name="method" state={state}>
        <select
          id="method"
          name="method"
          defaultValue="bank_transfer"
          className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700"
        >
          {methods.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </Field>
      <Field label="التاريخ" name="remitted_at" state={state}>
        <input
          id="remitted_at"
          name="remitted_at"
          type="date"
          defaultValue={state.values?.remitted_at || periodTo}
          className={fieldCls(state, "remitted_at")}
        />
      </Field>
      <Field label="المرجع (اختياري)" name="reference" state={state}>
        <input
          id="reference"
          name="reference"
          dir="ltr"
          placeholder="رقم التحويل"
          defaultValue={state.values?.reference ?? ""}
          className={"w-36 text-start " + fieldCls(state, "reference")}
        />
      </Field>
      <button
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {pending ? "جارٍ التسجيل…" : "تسجيل التوريد"}
      </button>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}

export function OwnerTaxForm({
  ownerId,
  vatNumber,
  crNumber,
}: {
  ownerId: string;
  vatNumber: string;
  crNumber: string;
}) {
  const [state, action, pending] = useActionState(setOwnerTaxInfo, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
      <input type="hidden" name="owner_id" value={ownerId} />
      <Field label="الرقم الضريبي (15 رقماً)" name="vat_number" state={state}>
        <input
          id="vat_number"
          name="vat_number"
          inputMode="numeric"
          dir="ltr"
          placeholder="3XXXXXXXXXXXXX3"
          defaultValue={state.values?.vat_number ?? vatNumber}
          className={"w-52 text-start " + fieldCls(state, "vat_number")}
        />
      </Field>
      <Field label="السجل التجاري" name="cr_number" state={state}>
        <input
          id="cr_number"
          name="cr_number"
          inputMode="numeric"
          dir="ltr"
          defaultValue={state.values?.cr_number ?? crNumber}
          className={"w-44 text-start " + fieldCls(state, "cr_number")}
        />
      </Field>
      <button disabled={pending} className={smallButton}>
        {pending ? "جارٍ الحفظ…" : "حفظ"}
      </button>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}
