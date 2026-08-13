"use client";

import { useActionState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { useResultToast, useSuccessToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import {
  activateContract,
  activateRenewal,
  issueInvoice,
  recordPayment,
  amendRent,
  terminateContract,
  renewContract,
} from "@/app/app/contracts/actions";

// The contract page's own forms.
//
// These moved out of the page for one reason: the page is a server component, and a message that
// stays where the action happened needs client state. Nothing else changed — same fields, same
// order, same guards.

const initial: FormState = {};

const sm = "rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700";
const smBad = "rounded-lg border border-red-400 bg-transparent px-3 py-1.5 text-sm outline-none dark:border-red-500";
const box = (state: FormState, name: string) => (state.field === name ? smBad : sm);

/** The message under the input it belongs to. Silent when the failure belongs to another field. */
function FieldError({ state, name }: { state: FormState; name: string }) {
  if (state.field !== name || !state.error) return null;
  return <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>;
}

/** An error that names no field — a permission refusal, a state the contract has already left. */
function FormLevelError({ state }: { state: FormState }) {
  if (!state.error || state.field) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      {state.error}
    </p>
  );
}

// Activation has nothing typed to lose, so both outcomes are toasts beside the button.
export function ActivateContractButton({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState(activateContract, initial);
  useResultToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="contract_id" value={contractId} />
      <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg disabled:opacity-60">
        {pending ? "جارٍ التفعيل…" : "تفعيل العقد"}
      </button>
    </form>
  );
}

export function ActivateRenewalButton({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState(activateRenewal, initial);
  useResultToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="contract_id" value={contractId} />
      <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg disabled:opacity-60">
        {pending ? "جارٍ التفعيل…" : "تفعيل التجديد"}
      </button>
    </form>
  );
}

// Success here is a redirect to the issued invoice, so only the refusal ever reaches this screen.
export function IssueInvoiceButton({ chargeId }: { chargeId: string }) {
  const [state, action, pending] = useActionState(issueInvoice, initial);
  useResultToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="charge_id" value={chargeId} />
      <button disabled={pending} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800">
        {pending ? "…" : "إصدار"}
      </button>
    </form>
  );
}

// A row in the charge table. The amount is the one thing typed here, and a refused payment keeps it.
export function RecordPaymentForm({
  contractId,
  chargeId,
  balanceHalalas,
  methods,
}: {
  contractId: string;
  chargeId: string;
  balanceHalalas: number;
  methods: Array<[string, string]>;
}) {
  const [state, action, pending] = useActionState(recordPayment, initial);
  useSuccessToast(state);
  return (
    <form action={action}>
      <div className="flex items-center gap-1">
        <input type="hidden" name="contract_id" value={contractId} />
        <input type="hidden" name="charge_id" value={chargeId} />
        <input
          name="amount"
          inputMode="decimal"
          aria-label="مبلغ الدفعة"
          defaultValue={state.values?.amount ?? (Number(balanceHalalas) / 100).toString()}
          className={"w-24 " + (state.field === "amount" ? smBad : sm)}
        />
        <select name="method" defaultValue="cash" aria-label="طريقة الدفع" className="rounded border border-neutral-300 bg-transparent px-1 py-1 text-xs outline-none dark:border-neutral-700">
          {methods.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button disabled={pending} className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-fg disabled:opacity-60">
          {pending ? "…" : "دفع"}
        </button>
      </div>
      <FieldError state={state} name="amount" />
      <FormLevelError state={state} />
    </form>
  );
}

export function AmendRentForm({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState(amendRent, initial);
  useSuccessToast(state);
  return (
    <form action={action} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-sm font-medium">تعديل الإيجار</p>
      <p className="text-xs text-neutral-500">يُعيد تسعير الاستحقاقات المستقبلية غير المدفوعة من تاريخ السريان.</p>
      <input type="hidden" name="contract_id" value={contractId} />
      <div className="flex flex-wrap gap-2">
        <div>
          <input
            name="new_annual"
            inputMode="decimal"
            placeholder="الإيجار السنوي الجديد (ر.س)"
            aria-label="الإيجار السنوي الجديد"
            defaultValue={state.values?.new_annual ?? ""}
            className={"w-44 " + box(state, "new_annual")}
          />
          <FieldError state={state} name="new_annual" />
        </div>
        <div>
          <input
            name="effective_date"
            type="date"
            aria-label="تاريخ سريان التعديل"
            defaultValue={state.values?.effective_date ?? ""}
            className={box(state, "effective_date")}
          />
          <FieldError state={state} name="effective_date" />
        </div>
      </div>
      <div>
        <input
          name="reason"
          placeholder="سبب التعديل"
          aria-label="سبب التعديل"
          defaultValue={state.values?.reason ?? ""}
          className={"w-full " + box(state, "reason")}
        />
        <FieldError state={state} name="reason" />
      </div>
      <FormLevelError state={state} />
      <button disabled={pending} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60">
        {pending ? "جارٍ الحفظ…" : "حفظ ملحق التعديل"}
      </button>
    </form>
  );
}

export function TerminateContractForm({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState(terminateContract, initial);
  useSuccessToast(state);
  return (
    <form action={action} className="space-y-2 rounded-2xl border border-red-200 bg-white p-4 shadow-sm dark:border-red-900/40 dark:bg-neutral-900">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">إنهاء مبكر</p>
      <p className="text-xs text-neutral-500">يُنهي العقد ويلغي الاستحقاقات المستقبلية غير المدفوعة ويُحرّر الوحدة.</p>
      <input type="hidden" name="contract_id" value={contractId} />
      <div>
        <input
          name="effective_date"
          type="date"
          aria-label="تاريخ الإنهاء"
          defaultValue={state.values?.effective_date ?? ""}
          className={box(state, "effective_date")}
        />
        <FieldError state={state} name="effective_date" />
      </div>
      <div>
        <input
          name="reason"
          placeholder="سبب الإنهاء"
          aria-label="سبب الإنهاء"
          defaultValue={state.values?.reason ?? ""}
          className={"w-full " + box(state, "reason")}
        />
        <FieldError state={state} name="reason" />
      </div>
      <FormLevelError state={state} />
      {/* Termination cancels every future unpaid charge and frees the unit. It is not undone by
          editing anything — the contract leaves 'active' for good — so it asks first. */}
      <ConfirmButton
        message="سيُنهى العقد وتُلغى استحقاقاته المستقبلية غير المدفوعة وتتحرّر الوحدة. هل تريد المتابعة؟"
        className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? "جارٍ الإنهاء…" : "إنهاء العقد"}
      </ConfirmButton>
    </form>
  );
}

export function RenewContractForm({
  contractId,
  defaultStart,
  defaultEnd,
  defaultAnnualSar,
}: {
  contractId: string;
  defaultStart: string;
  defaultEnd: string;
  defaultAnnualSar: string;
}) {
  const [state, action, pending] = useActionState(renewContract, initial);
  const labelCls = "mb-0.5 block text-xs text-neutral-500";
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs text-neutral-500">
        يُنشئ عقداً لاحقاً (مسودة) بنفس الوحدة والمستأجر — لا يُعدّل هذا العقد. تُراجع المسودة ثم تُفعّلها،
        وعندها يصبح هذا العقد «منتهياً» ويبدأ العقد الجديد.
      </p>
      <input type="hidden" name="contract_id" value={contractId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={labelCls}>بداية العقد الجديد</span>
          <input
            name="start_date"
            type="date"
            defaultValue={state.values?.start_date ?? defaultStart}
            className={"w-full " + box(state, "start_date")}
          />
          <FieldError state={state} name="start_date" />
        </label>
        <label className="block text-sm">
          <span className={labelCls}>نهاية العقد الجديد</span>
          <input
            name="end_date"
            type="date"
            defaultValue={state.values?.end_date ?? defaultEnd}
            className={"w-full " + box(state, "end_date")}
          />
          <FieldError state={state} name="end_date" />
        </label>
        <label className="block text-sm">
          <span className={labelCls}>الإيجار السنوي الجديد (ر.س)</span>
          <input
            name="new_annual"
            inputMode="decimal"
            defaultValue={state.values?.new_annual ?? defaultAnnualSar}
            className={"w-full " + box(state, "new_annual")}
          />
          <FieldError state={state} name="new_annual" />
        </label>
        <p className="self-end text-xs text-neutral-500">رقم عقد التجديد يُشتق تلقائياً من رقم العقد الحالي.</p>
      </div>
      <FormLevelError state={state} />
      <button disabled={pending} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60">
        {pending ? "جارٍ الإنشاء…" : "إنشاء عقد التجديد"}
      </button>
    </form>
  );
}
