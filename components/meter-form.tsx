"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createMeter, type MeterState } from "@/app/app/utilities/actions";
import { UTILITY_TYPE_AR } from "@/lib/labels";
import { useFormDrawerClose } from "@/components/form-drawer";
import { Button, useToast } from "@/components/ui";

export type MeterProperty = { id: string; label: string; units: { id: string; label: string }[] };

const initial: MeterState = {};
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
 * Add-meter form. Only three fields are visible — type, number, and whether it serves the whole
 * property or one unit — because the office enters meter numbers and little else. Everything the
 * provider prints on the bill sits behind "تفاصيل إضافية".
 *
 * `properties` carries its own units so the unit list narrows without a round trip; when the form
 * is opened from a property page, `fixedPropertyId` pins it to that property.
 */
export function MeterForm({
  properties,
  fixedPropertyId,
  fixedUnitId,
}: {
  properties: MeterProperty[];
  fixedPropertyId?: string;
  fixedUnitId?: string;
}) {
  const [state, action, pending] = useActionState(createMeter, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [propertyId, setPropertyId] = useState(fixedPropertyId ?? properties[0]?.id ?? "");
  const [showMore, setShowMore] = useState(false);
  const closeDrawer = useFormDrawerClose();
  const { toast } = useToast();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setShowMore(false);
      closeDrawer?.();
      toast({ title: "تمت إضافة العدّاد", tone: "success" });
    }
  }, [state.ok]);

  const units = properties.find((p) => p.id === propertyId)?.units ?? [];

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {fixedPropertyId ? (
        <input type="hidden" name="property_id" value={fixedPropertyId} />
      ) : (
        <Field label="العقار *">
          <select
            name="property_id"
            required
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className={cls}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="نوع المرفق *">
        <select name="utility_type" defaultValue="electricity" className={cls}>
          {Object.entries(UTILITY_TYPE_AR).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>

      <Field label="رقم العدّاد *">
        <input name="meter_number" required dir="ltr" className={cls + " text-right"} />
      </Field>

      {fixedUnitId ? (
        <input type="hidden" name="unit_id" value={fixedUnitId} />
      ) : (
        <Field label="يخدم">
          <select name="unit_id" defaultValue="" className={cls}>
            <option value="">العقار كاملاً (عدّاد رئيسي)</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>وحدة {u.label}</option>
            ))}
          </select>
        </Field>
      )}

      <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="text-sm font-medium text-brand hover:underline"
        >
          {showMore ? "إخفاء التفاصيل الإضافية" : "تفاصيل إضافية (اختيارية)"}
        </button>

        {showMore && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="رقم الحساب">
              <input name="account_number" dir="ltr" className={cls + " text-right"} />
            </Field>
            <Field label="رقم الاشتراك">
              <input name="subscription_number" dir="ltr" className={cls + " text-right"} />
            </Field>
            <Field label="المزوّد">
              <input name="provider" placeholder="السعودية للكهرباء / المياه الوطنية" className={cls} />
            </Field>
            <Field label="تاريخ التركيب">
              <input name="installed_at" type="date" dir="ltr" className={cls} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="ملاحظات">
                <textarea name="notes" rows={2} className={cls} />
              </Field>
            </div>
          </div>
        )}
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "إضافة العدّاد"}
        </Button>
      </div>
    </form>
  );
}
