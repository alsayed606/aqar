"use client";

import { useActionState } from "react";
import { createContract, type ContractState } from "@/app/app/contracts/actions";
import { Combobox } from "@/components/ui";

const initial: ContractState = {};

type Option = { id: string; label: string };

export function ContractForm({
  units,
  tenants,
  // Preselected when the form is opened from a vacant unit's "إنشاء عقد" action.
  defaultUnitId = "",
}: {
  units: Option[];
  tenants: Option[];
  defaultUnitId?: string;
}) {
  const [state, action, pending] = useActionState(createContract, initial);

  const noUnits = units.length === 0;
  const noTenants = tenants.length === 0;

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium">الوحدة *</label>
        <Combobox
          name="unit_id"
          defaultValue={defaultUnitId}
          placeholder={noUnits ? "لا توجد وحدات — أضِفها أولاً" : "ابحث واختر الوحدة…"}
          options={units.map((u) => ({ value: u.id, label: u.label }))}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">المستأجر *</label>
        <Combobox
          name="tenant_id"
          placeholder={noTenants ? "لا يوجد مستأجرون — أضِفهم أولاً" : "ابحث واختر المستأجر…"}
          options={tenants.map((t) => ({ value: t.id, label: t.label }))}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="contract_kind">
          نوع العقد
        </label>
        <select
          id="contract_kind"
          name="contract_kind"
          defaultValue="residential"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          <option value="residential">سكني (بدون ضريبة)</option>
          <option value="commercial">تجاري (ضريبة 15%)</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="payment_frequency">
          دورية الدفع
        </label>
        <select
          id="payment_frequency"
          name="payment_frequency"
          defaultValue="quarterly"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          <option value="monthly">شهري</option>
          <option value="quarterly">ربع سنوي</option>
          <option value="semi_annual">نصف سنوي</option>
          <option value="annual">سنوي</option>
          <option value="one_time">دفعة واحدة</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="start_date">
          تاريخ البداية *
        </label>
        <input
          id="start_date"
          name="start_date"
          type="date"
          required
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="end_date">
          تاريخ النهاية *
        </label>
        <input
          id="end_date"
          name="end_date"
          type="date"
          required
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="annual_rent">
          الإيجار السنوي (ر.س) *
        </label>
        <input
          id="annual_rent"
          name="annual_rent"
          inputMode="decimal"
          required
          placeholder="120000"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="deposit">
          التأمين (ر.س)
        </label>
        <input
          id="deposit"
          name="deposit"
          inputMode="decimal"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="service_fees">
          رسوم الخدمات (ر.س)
        </label>
        <input
          id="service_fees"
          name="service_fees"
          inputMode="decimal"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

      {/* Contract number is assigned by the system (CT-YYYY-NNNNN) — no manual entry. */}
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 sm:col-span-2 dark:bg-slate-800/50 dark:text-slate-400">
        رقم العقد يُولَّد تلقائياً بصيغة موحّدة <span dir="ltr" className="font-mono">CT-YYYY-NNNNN</span> عند الحفظ.
      </p>

      {/* Optional commercial details: shop/trade name + signing representative (per contract). */}
      <details className="rounded-lg border border-neutral-200 sm:col-span-2 dark:border-neutral-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          اسم المحل التجاري وممثل المنشأة (اختياري)
        </summary>
        <div className="grid gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 dark:border-neutral-800">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium" htmlFor="trade_name">
              اسم المحل التجاري
            </label>
            <input id="trade_name" name="trade_name" placeholder="مثال: مخابز الريان" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="representative_name">
              اسم ممثل المنشأة
            </label>
            <input id="representative_name" name="representative_name" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="representative_capacity">
              صفته
            </label>
            <input id="representative_capacity" name="representative_capacity" placeholder="مثال: مدير عام / مفوّض" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="representative_id">
              رقم هوية الممثل <span className="text-neutral-400">(اختياري)</span>
            </label>
            <input id="representative_id" name="representative_id" dir="ltr" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="representative_phone">
              جوال الممثل <span className="text-neutral-400">(اختياري)</span>
            </label>
            <input id="representative_phone" name="representative_phone" dir="ltr" placeholder="05XXXXXXXX" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700" />
          </div>
        </div>
      </details>

      {/* Optional منصة إيجار alignment block — entirely optional, presentation only. */}
      <details className="rounded-lg border border-neutral-200 sm:col-span-2 dark:border-neutral-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          بيانات منصة إيجار (اختياري)
        </summary>
        <div className="grid gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 dark:border-neutral-800">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium" htmlFor="ejar_contract_number">
              رقم العقد في منصة إيجار
            </label>
            <input id="ejar_contract_number" name="ejar_contract_number" dir="ltr" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700" />
          </div>

          <div className="sm:col-span-2 mt-1 text-xs font-medium text-neutral-500">معلومات الوسيط العقاري</div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ejar_broker_office">اسم المكتب</label>
            <input id="ejar_broker_office" name="ejar_broker_office" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ejar_broker_number">رقم المكتب</label>
            <input id="ejar_broker_number" name="ejar_broker_number" dir="ltr" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium" htmlFor="ejar_broker_representative">ممثل المكتب</label>
            <input id="ejar_broker_representative" name="ejar_broker_representative" className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700" />
          </div>

          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">هل توجد بنود أو شروط إضافية في عقد منصة إيجار؟</legend>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="ejar_has_extra_terms" value="yes" className="accent-brand" /> نعم
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="ejar_has_extra_terms" value="no" className="accent-brand" /> لا
              </label>
            </div>
          </fieldset>
        </div>
      </details>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending || noUnits || noTenants}
          className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : "إنشاء العقد (مسودة)"}
        </button>
      </div>
    </form>
  );
}
