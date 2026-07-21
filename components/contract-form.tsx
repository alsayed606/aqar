"use client";

import { useActionState } from "react";
import { createContract, type ContractState } from "@/app/app/contracts/actions";

const initial: ContractState = {};

type Option = { id: string; label: string };

export function ContractForm({
  units,
  tenants,
}: {
  units: Option[];
  tenants: Option[];
}) {
  const [state, action, pending] = useActionState(createContract, initial);

  const noUnits = units.length === 0;
  const noTenants = tenants.length === 0;

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="unit_id">
          الوحدة *
        </label>
        <select
          id="unit_id"
          name="unit_id"
          required
          defaultValue=""
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          <option value="" disabled>
            {noUnits ? "لا توجد وحدات — أضِفها أولاً" : "اختر الوحدة"}
          </option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="tenant_id">
          المستأجر *
        </label>
        <select
          id="tenant_id"
          name="tenant_id"
          required
          defaultValue=""
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
        >
          <option value="" disabled>
            {noTenants ? "لا يوجد مستأجرون — أضِفهم أولاً" : "اختر المستأجر"}
          </option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
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

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="contract_number">
          رقم العقد (اختياري)
        </label>
        <input
          id="contract_number"
          name="contract_number"
          dir="ltr"
          placeholder="يُولّد تلقائياً إن تُرك فارغاً"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-right outline-none focus:border-brand dark:border-neutral-700"
        />
      </div>

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
