"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createBill, type BillState } from "@/app/app/utilities/actions";
import { parseArabicNumber } from "@/lib/num";
import { useFormDrawerClose } from "@/components/form-drawer";
import { Button, useToast } from "@/components/ui";

export type BillMeter = { id: string; label: string };

const initial: BillState = {};
const cls = "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-slate-700";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

/**
 * Record a monthly utility bill. The office copies what the provider printed; the system derives
 * the rest — the total, the consumption, and who bears it. Nothing here is asked twice.
 */
export function BillForm({ meters, fixedMeterId }: { meters: BillMeter[]; fixedMeterId?: string }) {
  const [state, action, pending] = useActionState(createBill, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [amount, setAmount] = useState("");
  const [vat, setVat] = useState("");
  const [otherFees, setOtherFees] = useState("");
  const closeDrawer = useFormDrawerClose();
  const { toast } = useToast();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setAmount("");
      setVat("");
      setOtherFees("");
      closeDrawer?.();
      toast({ title: "تمت إضافة الفاتورة", tone: "success" });
    }
  }, [state.ok]);

  // Shown, never posted: the stored total is a generated column, so a number typed here could only
  // ever contradict it.
  const total = (parseArabicNumber(amount) ?? 0) + (parseArabicNumber(vat) ?? 0) + (parseArabicNumber(otherFees) ?? 0);
  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {fixedMeterId ? (
        <input type="hidden" name="meter_id" value={fixedMeterId} />
      ) : (
        <Field label="العدّاد *">
          <select name="meter_id" required defaultValue={meters[0]?.id ?? ""} className={cls}>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="شهر الفاتورة *">
        <input name="billing_month" type="month" required defaultValue={thisMonth} max={thisMonth} dir="ltr" className={cls} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="القراءة السابقة">
          <input name="previous_reading" inputMode="decimal" dir="ltr" className={cls + " text-right"} />
        </Field>
        <Field label="القراءة الحالية">
          <input name="current_reading" inputMode="decimal" dir="ltr" className={cls + " text-right"} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        القراءتان اختياريتان. بإدخالهما يُحسب استهلاك الفاتورة؛ وإن جاءت الحالية أقلّ من السابقة تُوسَم
        «تحتاج مراجعة» بلا رقم مخمَّن.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="قيمة الاستهلاك (ر.س) *">
          <input
            name="amount"
            required
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cls + " text-right"}
          />
        </Field>
        <Field label="ضريبة القيمة المضافة (ر.س)">
          <input
            name="vat"
            inputMode="decimal"
            dir="ltr"
            value={vat}
            onChange={(e) => setVat(e.target.value)}
            className={cls + " text-right"}
          />
        </Field>
        <Field label="رسوم أخرى (ر.س)">
          <input
            name="other_fees"
            inputMode="decimal"
            dir="ltr"
            value={otherFees}
            onChange={(e) => setOtherFees(e.target.value)}
            className={cls + " text-right"}
          />
        </Field>
      </div>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
        الإجمالي: <span dir="ltr" className="font-medium">{total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> ر.س
      </p>

      <Field label="تاريخ الاستحقاق">
        <input name="due_date" type="date" dir="ltr" className={cls} />
      </Field>

      <Field label="ملاحظات">
        <textarea name="notes" rows={2} className={cls} />
      </Field>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "إضافة الفاتورة"}
        </Button>
      </div>
    </form>
  );
}
