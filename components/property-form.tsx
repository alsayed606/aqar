"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createProperty, type PropState } from "@/app/app/properties/actions";
import { PROPERTY_KIND_AR } from "@/lib/labels";
import { LandlordPicker, type Landlord } from "@/components/landlord-picker";
import { UpgradeModal } from "@/components/upgrade-modal";
import { useFormDrawerClose } from "@/components/form-drawer";
import { Button, useToast } from "@/components/ui";
import { cx } from "@/lib/cx";

const initial: PropState = {};
const cls = "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-slate-700";

const STEPS = ["البيانات الأساسية", "الصك والمساحة", "الصور والملفات"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

/**
 * Add-property wizard. All three steps live inside ONE <form>, with inactive steps hidden via CSS
 * (not unmounted) so a single submit still carries every field. `required` is bound to the active
 * step so the browser never tries to validate a hidden, unfocusable input.
 */
export function PropertyForm({ owners = [] }: { owners?: Landlord[] }) {
  const [state, action, pending] = useActionState(createProperty, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [holding, setHolding] = useState("owned");
  const [step, setStep] = useState(0);
  const isOwned = holding === "owned";
  const closeDrawer = useFormDrawerClose();
  const { toast } = useToast();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setHolding("owned");
      setStep(0);
      closeDrawer?.();
      toast({ title: "تمت إضافة العقار", tone: "success" });
    }
  }, [state.ok]);

  const limitHit = !!state.error && /الحد الأقصى|PLAN_LIMIT/.test(state.error);

  return (
    <form ref={formRef} action={action} className="space-y-5">
      <UpgradeModal open={limitHit} message={state.error} />

      {/* Step indicator */}
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                i === step ? "bg-brand text-white" : i < step ? "bg-brand/15 text-brand" : "bg-slate-100 text-slate-400 dark:bg-slate-800",
              )}
              aria-label={`الخطوة ${i + 1}: ${s}`}
            >
              {i + 1}
            </button>
            <span className={cx("truncate", i === step ? "font-medium text-slate-900 dark:text-white" : "text-slate-400")}>{s}</span>
          </li>
        ))}
      </ol>

      {/* Step 1 — basics */}
      <div className={cx("grid gap-3", step === 0 ? "" : "hidden")}>
        <Field label="اسم العقار *">
          <input name="name" required={step === 0} placeholder="مثال: برج الياسمين" className={cls} />
        </Field>
        <Field label="كود العقار">
          <input name="property_code" dir="ltr" className={cls + " text-right"} />
        </Field>
        <Field label="علاقة العقار">
          <select name="holding_type" value={holding} onChange={(e) => setHolding(e.target.value)} className={cls}>
            <option value="owned">عقار مملوك</option>
            <option value="managed">إدارة أملاك (غير مملوك)</option>
            <option value="investment">استثمار</option>
          </select>
        </Field>
        <Field label="التصنيف">
          <select name="property_kind" defaultValue="residential" className={cls}>
            {Object.entries(PROPERTY_KIND_AR).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </Field>

        {!isOwned && (
          <Field label="المالك *">
            <LandlordPicker owners={owners} />
          </Field>
        )}

        <p className="text-xs text-slate-500">
          {isOwned ? "عقار مملوك للمنشأة — يُسجَّل المالك تلقائياً." : "ابحث عن المالك أو أضِف مالكاً جديداً."}{" "}
          <Link href="/app/owners" className="text-brand hover:underline">إدارة الملّاك</Link>
        </p>
      </div>

      {/* Step 2 — deed + area */}
      <div className={cx("grid gap-3 sm:grid-cols-2", step === 1 ? "" : "hidden")}>
        <Field label="نوع العقار">
          <input name="property_type" placeholder="برج / مجمّع تجاري / مستودع…" className={cls} />
        </Field>
        <Field label="نوع الإشغال">
          <select name="occupancy_type" defaultValue="" className={cls}>
            <option value="">—</option>
            <option value="family">عوائل</option>
            <option value="bachelor">عزّاب</option>
          </select>
        </Field>
        <Field label="المدينة"><input name="city" className={cls} /></Field>
        <Field label="الحي"><input name="district" className={cls} /></Field>

        <div className="sm:col-span-2 mt-1 text-xs font-medium text-slate-500">بيانات الصك</div>
        <Field label="نوع الصك"><input name="deed_type" className={cls} /></Field>
        <Field label="رقم الصك"><input name="deed_number" dir="ltr" className={cls + " text-right"} /></Field>
        <Field label="تاريخ الصك"><input name="deed_date" type="date" dir="ltr" className={cls} /></Field>

        <div className="sm:col-span-2 mt-1 text-xs font-medium text-slate-500">العدّادات وعدد الوحدات المخطّط</div>
        <Field label="عدّاد الماء"><input name="water_meter" dir="ltr" className={cls + " text-right"} /></Field>
        <Field label="عدّاد الكهرباء"><input name="electricity_meter" dir="ltr" className={cls + " text-right"} /></Field>
        <Field label="وحدات سكنية"><input name="planned_residential_units" inputMode="numeric" className={cls} /></Field>
        <Field label="وحدات تجارية"><input name="planned_commercial_units" inputMode="numeric" className={cls} /></Field>
      </div>

      {/* Step 3 — files (needs Supabase Storage; not built yet) */}
      <div className={cx(step === 2 ? "" : "hidden")}>
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="font-medium text-slate-600 dark:text-slate-300">الصور والملفات</p>
          <p className="mt-1 text-sm text-slate-400">رفع صور العقار والمرفقات — قريباً.</p>
          <p className="mt-3 text-xs text-slate-400">يمكنك حفظ العقار الآن وإضافة الملفات لاحقاً.</p>
        </div>
      </div>

      {state.error && !limitHit && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{state.error}</p>
      )}

      {/* Wizard controls. The submit stays available on every step because steps 2-3 are optional. */}
      <div className="flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        {step > 0 && (
          <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>السابق</Button>
        )}
        {step < STEPS.length - 1 && (
          <Button type="button" variant="secondary" onClick={() => setStep((s) => s + 1)}>التالي</Button>
        )}
        <Button type="submit" disabled={pending} className="me-auto">
          {pending ? "جارٍ الحفظ…" : "إضافة العقار"}
        </Button>
      </div>
    </form>
  );
}
