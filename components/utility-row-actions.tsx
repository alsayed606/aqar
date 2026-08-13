"use client";

import { useActionState } from "react";
import { fieldCls, useResultToast } from "@/components/form-field";
import { ConfirmButton } from "@/components/confirm-button";
import type { FormState } from "@/lib/form-state";
import {
  clearBillPaid,
  deleteBill,
  deleteMeter,
  deleteReading,
  markBillPaid,
  markReadingReset,
  setMeterStatus,
  updateReadingValue,
} from "@/app/app/utilities/actions";

// The buttons that live inside the meter, reading and bill tables.
//
// They used to redirect back to a URL that carried the filter, the page number AND the message —
// so a refusal cost the reader their place in a long list to deliver one sentence. Now each answers
// in a toast beside itself and the list refreshes underneath, unmoved.

const initial: FormState = {};

const cellButton =
  "rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800";
const dangerButton =
  "rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20";

export function MeterStatusForm({
  meterId,
  propertyId,
  status,
  options,
}: {
  meterId: string;
  propertyId: string;
  status: string;
  options: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(setMeterStatus, initial);
  useResultToast(state);

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="meter_id" value={meterId} />
      <input type="hidden" name="property_id" value={propertyId} />
      <select
        name="status"
        defaultValue={status}
        aria-label="حالة العدّاد"
        className="rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-xs outline-none dark:border-neutral-700"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button disabled={pending} className={cellButton}>{pending ? "…" : "حفظ"}</button>
    </form>
  );
}

/** Deletion keeps its confirmation. Moving the message is a UI change; removing a guard is not. */
export function DeleteMeterButton({
  meterId,
  propertyId,
  meterNumber,
}: {
  meterId: string;
  propertyId: string;
  meterNumber: string;
}) {
  const [state, action] = useActionState(deleteMeter, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="meter_id" value={meterId} />
      <input type="hidden" name="property_id" value={propertyId} />
      <ConfirmButton
        message={`حذف العدّاد «${meterNumber}»؟ تبقى قراءاته في السجلّات.`}
        className={dangerButton}
      >
        حذف
      </ConfirmButton>
    </form>
  );
}

export function MarkResetButton({ readingId }: { readingId: string }) {
  const [state, action, pending] = useActionState(markReadingReset, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="reading_id" value={readingId} />
      <button disabled={pending} className={cellButton}>{pending ? "…" : "عدّاد مُبدَّل"}</button>
    </form>
  );
}

/** The one row action with something typed in it — so its refusal marks the box, not just the air. */
export function UpdateReadingForm({ readingId, value }: { readingId: string; value: number }) {
  const [state, action, pending] = useActionState(updateReadingValue, initial);
  useResultToast(state);

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="reading_id" value={readingId} />
      <input
        name="value"
        inputMode="decimal"
        dir="ltr"
        defaultValue={String(value)}
        aria-label="تصحيح القراءة"
        className={"w-24 " + (state.field === "value" ? fieldCls(state, "value") : "rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs outline-none dark:border-neutral-700")}
      />
      <button disabled={pending} className={cellButton}>{pending ? "…" : "تصحيح"}</button>
    </form>
  );
}

export function DeleteReadingButton({
  readingId,
  readingDate,
}: {
  readingId: string;
  readingDate: string;
}) {
  const [state, action] = useActionState(deleteReading, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="reading_id" value={readingId} />
      <ConfirmButton
        message={`حذف قراءة ${readingDate}؟ سيُعاد احتساب استهلاك القراءة التالية.`}
        className={dangerButton}
      >
        حذف
      </ConfirmButton>
    </form>
  );
}

export function BillPaidButton({ billId, isPaid }: { billId: string; isPaid: boolean }) {
  // Two different actions, so two hooks — the component picks which one this row needs. Sharing one
  // hook would mean a boolean flag reaching the server to decide, which is the split this avoids.
  const [paidState, markPaid, marking] = useActionState(markBillPaid, initial);
  const [clearState, clearPaid, clearing] = useActionState(clearBillPaid, initial);
  useResultToast(paidState);
  useResultToast(clearState);

  return (
    <form action={isPaid ? clearPaid : markPaid}>
      <input type="hidden" name="bill_id" value={billId} />
      <button disabled={marking || clearing} className={cellButton}>
        {marking || clearing ? "…" : isPaid ? "إلغاء السداد" : "سُدّدت"}
      </button>
    </form>
  );
}

export function DeleteBillButton({
  billId,
  billingMonth,
  meterNumber,
}: {
  billId: string;
  billingMonth: string;
  meterNumber: string;
}) {
  const [state, action] = useActionState(deleteBill, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="bill_id" value={billId} />
      <ConfirmButton
        message={`حذف فاتورة ${billingMonth.slice(0, 7)} للعدّاد ${meterNumber}؟`}
        className={dangerButton}
      >
        حذف
      </ConfirmButton>
    </form>
  );
}
