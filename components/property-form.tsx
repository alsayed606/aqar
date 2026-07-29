"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createProperty, type PropState } from "@/app/app/properties/actions";
import { PROPERTY_KIND_AR } from "@/lib/labels";
import { LandlordPicker, type Landlord } from "@/components/landlord-picker";
import { UpgradeModal } from "@/components/upgrade-modal";
import { useFormDrawerClose } from "@/components/form-drawer";

const initial: PropState = {};
const cls = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

export function PropertyForm({ owners = [] }: { owners?: Landlord[] }) {
  const [state, action, pending] = useActionState(createProperty, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [holding, setHolding] = useState("owned");
  const isOwned = holding === "owned";
  const closeDrawer = useFormDrawerClose();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setHolding("owned");
      closeDrawer?.();
    }
  }, [state.ok]);

  const limitHit = !!state.error && /الحد الأقصى|PLAN_LIMIT/.test(state.error);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      <UpgradeModal open={limitHit} message={state.error} />

      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium" htmlFor="name">اسم العقار *</label>
        <input id="name" name="name" required placeholder="مثال: برج الياسمين" className={cls} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="holding_type">علاقة العقار</label>
        <select id="holding_type" name="holding_type" value={holding} onChange={(e) => setHolding(e.target.value)} className={cls}>
          <option value="owned">عقار مملوك</option>
          <option value="managed">إدارة أملاك (غير مملوك)</option>
          <option value="investment">استثمار</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="property_kind">التصنيف</label>
        <select id="property_kind" name="property_kind" defaultValue="residential" className={cls}>
          {Object.entries(PROPERTY_KIND_AR).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {!isOwned && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium">المالك *</label>
          <LandlordPicker owners={owners} />
        </div>
      )}

      <p className="text-xs text-neutral-500 sm:col-span-2">
        {isOwned
          ? "عقار مملوك للمنشأة — يُسجَّل المالك تلقائياً."
          : "اختر المالك من القائمة أو أضِف مالكاً جديداً."}{" "}
        <Link href="/app/owners" className="text-brand hover:underline">إدارة الملّاك</Link>
      </p>

      <details className="rounded-lg border border-neutral-200 sm:col-span-2 dark:border-neutral-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          تفاصيل إضافية (اختياري)
        </summary>
        <div className="grid gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 dark:border-neutral-800">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="property_code">كود العقار</label>
            <input id="property_code" name="property_code" dir="ltr" className={cls + " text-right"} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="property_type">نوع العقار</label>
            <input id="property_type" name="property_type" placeholder="برج / مجمّع تجاري / مستودع…" className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="occupancy_type">نوع الإشغال</label>
            <select id="occupancy_type" name="occupancy_type" defaultValue="" className={cls}>
              <option value="">—</option>
              <option value="family">عوائل</option>
              <option value="bachelor">عزّاب</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="city">المدينة</label>
            <input id="city" name="city" className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="district">الحي</label>
            <input id="district" name="district" className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="water_meter">عدّاد الماء</label>
            <input id="water_meter" name="water_meter" dir="ltr" className={cls + " text-right"} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="electricity_meter">عدّاد الكهرباء</label>
            <input id="electricity_meter" name="electricity_meter" dir="ltr" className={cls + " text-right"} />
          </div>
          <div className="sm:col-span-2 mt-1 text-xs font-medium text-neutral-500">بيانات الصك</div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="deed_type">نوع الصك</label>
            <input id="deed_type" name="deed_type" className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="deed_number">رقم الصك</label>
            <input id="deed_number" name="deed_number" dir="ltr" className={cls + " text-right"} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="deed_date">تاريخ الصك</label>
            <input id="deed_date" name="deed_date" type="date" dir="ltr" className={cls} />
          </div>
          <div className="sm:col-span-2 mt-1 text-xs font-medium text-neutral-500">عدد الوحدات المخطّط</div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="planned_residential_units">وحدات سكنية</label>
            <input id="planned_residential_units" name="planned_residential_units" inputMode="numeric" className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="planned_commercial_units">وحدات تجارية</label>
            <input id="planned_commercial_units" name="planned_commercial_units" inputMode="numeric" className={cls} />
          </div>
        </div>
      </details>

      {state.error && !limitHit && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60">
          {pending ? "جارٍ الحفظ…" : "إضافة العقار"}
        </button>
      </div>
    </form>
  );
}
