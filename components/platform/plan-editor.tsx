"use client";

import { useState } from "react";
import { upsertPlan } from "@/app/platform/actions";
import { Button, Drawer } from "@/components/ui";

// Editor for one plan, or for a new one when `plan` is absent.
//
// Prices are entered in riyals and stored in halalas — the operator should never type 29900 for a
// 299 SAR plan. An empty limit box means UNLIMITED; the form says so rather than leaving the
// operator to guess whether blank means "no ceiling" or "don't change it".

export type PlanRow = {
  code: string;
  name_ar: string;
  price_halalas: number;
  max_properties: number | null;
  max_units: number | null;
  max_members: number | null;
  is_public: boolean;
  sort: number;
};

const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700";

export function PlanEditor({ plan }: { plan?: PlanRow }) {
  const [open, setOpen] = useState(false);
  const isNew = !plan;

  return (
    <>
      {isNew ? (
        <Button size="sm" onClick={() => setOpen(true)}>+ خطة جديدة</Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-brand">تعديل</Button>
      )}

      <Drawer open={open} onClose={() => setOpen(false)} title={isNew ? "خطة جديدة" : `تعديل: ${plan!.name_ar}`}>
        <form action={upsertPlan} className="space-y-4">
          <label className="block text-sm">
            رمز الخطة <span className="text-slate-400">(إنجليزي صغير، لا يُغيَّر لاحقاً)</span>
            <input
              name="code"
              dir="ltr"
              required
              defaultValue={plan?.code ?? ""}
              readOnly={!isNew}
              className={fieldCls + (isNew ? "" : " text-slate-400")}
            />
          </label>

          <label className="block text-sm">
            الاسم المعروض
            <input name="name_ar" required defaultValue={plan?.name_ar ?? ""} className={fieldCls} />
          </label>

          <label className="block text-sm">
            السعر الشهري (ريال)
            <input
              name="price_sar"
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              required
              defaultValue={plan ? (plan.price_halalas / 100).toString() : "0"}
              className={fieldCls}
            />
            <span className="mt-1 block text-[11px] text-slate-400">صفر = «تواصل معنا» (خطة غير مسعّرة).</span>
          </label>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">الحدود</legend>
            <p className="text-[11px] text-slate-400">
              اترك الحقل فارغاً ليكون <b>بلا حد</b>. خفض الحدّ لا يحذف شيئاً قائماً — يمنع الإنشاء الجديد فقط.
            </p>
            {([
              ["max_properties", "أقصى عدد عقارات"],
              ["max_units", "أقصى عدد وحدات"],
              ["max_members", "أقصى عدد أعضاء"],
            ] as const).map(([name, label]) => (
              <label key={name} className="block text-sm">
                {label}
                <input
                  name={name}
                  type="number"
                  min="0"
                  dir="ltr"
                  placeholder="بلا حد"
                  defaultValue={plan?.[name] ?? ""}
                  className={fieldCls}
                />
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              الترتيب
              <input name="sort" type="number" dir="ltr" defaultValue={plan?.sort ?? 0} className={fieldCls} />
            </label>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_public" defaultChecked={plan?.is_public ?? true} className="h-4 w-4" />
              تظهر في صفحة الأسعار
            </label>
          </div>

          <Button type="submit" className="w-full">{isNew ? "إنشاء الخطة" : "حفظ التغييرات"}</Button>
        </form>
      </Drawer>
    </>
  );
}
