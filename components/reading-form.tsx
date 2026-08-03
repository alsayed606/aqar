"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createReading, type ReadingState } from "@/app/app/utilities/actions";
import { parseArabicNumber } from "@/lib/num";
import { useFormDrawerClose } from "@/components/form-drawer";
import { Button, useToast } from "@/components/ui";

export type ReadingMeter = { id: string; label: string; lastValue: number | null };

const initial: ReadingState = {};
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
 * Record a meter reading. When the entered number falls below the meter's last reading the form
 * stops and asks whether the meter was replaced, rather than letting a typo through to become a
 * plausible-looking consumption figure. Confirming ticks is_reset; that flag is the ONLY thing that
 * makes the system treat the reading itself as the consumption (design note §3).
 */
export function ReadingForm({ meters, fixedMeterId }: { meters: ReadingMeter[]; fixedMeterId?: string }) {
  const [state, action, pending] = useActionState(createReading, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [meterId, setMeterId] = useState(fixedMeterId ?? meters[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [isReset, setIsReset] = useState(false);
  const closeDrawer = useFormDrawerClose();
  const { toast } = useToast();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setValue("");
      setIsReset(false);
      closeDrawer?.();
      toast({ title: "تم تسجيل القراءة", tone: "success" });
    }
  }, [state.ok]);

  const lastValue = meters.find((m) => m.id === meterId)?.lastValue ?? null;
  const entered = parseArabicNumber(value);
  const isLower = lastValue != null && entered != null && entered < lastValue;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {fixedMeterId ? (
        <input type="hidden" name="meter_id" value={fixedMeterId} />
      ) : (
        <Field label="العدّاد *">
          <select
            name="meter_id"
            required
            value={meterId}
            onChange={(e) => setMeterId(e.target.value)}
            className={cls}
          >
            {meters.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="تاريخ القراءة *">
        <input name="reading_date" type="date" required defaultValue={today} max={today} dir="ltr" className={cls} />
      </Field>

      <Field label="القراءة *">
        <input
          name="value"
          required
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cls + " text-right"}
        />
      </Field>

      {lastValue != null && !isLower && (
        <p className="text-xs text-slate-500">آخر قراءة مسجَّلة: <span dir="ltr">{lastValue}</span></p>
      )}

      {isLower && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            القراءة أقلّ من السابقة (<span dir="ltr">{lastValue}</span>) — هل استُبدل العدّاد؟
          </p>
          <label className="mt-2 flex items-center gap-2 text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              name="is_reset"
              checked={isReset}
              onChange={(e) => setIsReset(e.target.checked)}
              className="h-4 w-4"
            />
            نعم، عدّاد جديد بدأ من الصفر
          </label>
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
            إن كانت خطأ إدخال فصحّح الرقم أعلاه. وإن حُفظت كما هي بلا تأكيد، تُسجَّل بلا استهلاك وتظهر
            ضمن «تحتاج مراجعة».
          </p>
        </div>
      )}

      <Field label="ملاحظة">
        <input name="note" className={cls} />
      </Field>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "تسجيل القراءة"}
        </Button>
      </div>
    </form>
  );
}
