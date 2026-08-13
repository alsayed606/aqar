"use client";

import { useActionState } from "react";
import { useSuccessToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { updateDraftContract } from "@/app/app/contracts/actions";

// Editing a draft contract: twenty fields, one refusal at a time.
//
// This form had the worst version of the old behaviour — a rejected date sent the whole page through
// a redirect, and the other nineteen fields went back to what was stored. Now the attempt comes back
// with the message, and only the field that failed is marked.

export type DraftOption = { id: string; label: string };

export type DraftContractValues = {
  id: string;
  unit_id: string | null;
  tenant_id: string | null;
  contract_kind: string;
  payment_frequency: string;
  start_date: string;
  end_date: string;
  annual_rent_halalas: number;
  deposit_halalas: number;
  service_fees_halalas: number;
  trade_name: string | null;
  representative_name: string | null;
  representative_capacity: string | null;
  representative_phone: string | null;
  ejar_contract_number: string | null;
  ejar_broker_office: string | null;
  ejar_broker_number: string | null;
  ejar_broker_representative: string | null;
  ejar_has_extra_terms: boolean | null;
};

const initial: FormState = {};
const ok = "w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700";
const bad = "w-full rounded-lg border border-red-400 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-red-500";

export function ContractDraftForm({
  contract,
  units,
  tenants,
}: {
  contract: DraftContractValues;
  units: DraftOption[];
  tenants: DraftOption[];
}) {
  const [state, action, pending] = useActionState(updateDraftContract, initial);
  useSuccessToast(state);

  const cls = (name: string) => (state.field === name ? bad : ok);
  // The attempt wins over the stored value, and the stored value wins over nothing.
  const held = (name: string, stored: string | number | null) =>
    state.values?.[name] ?? (stored == null ? "" : String(stored));
  const sar = (halalas: number) => String(Number(halalas) / 100);

  const Err = ({ name }: { name: string }) =>
    state.field === name && state.error ? (
      <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
    ) : null;

  const extraTerms = state.values?.ejar_has_extra_terms
    ?? (contract.ejar_has_extra_terms === true ? "yes" : contract.ejar_has_extra_terms === false ? "no" : "");

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="contract_id" value={contract.id} />

      <div>
        <label className="mb-1 block text-sm font-medium">الوحدة *</label>
        <select name="unit_id" required defaultValue={held("unit_id", contract.unit_id)} className={cls("unit_id")}>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.label}</option>
          ))}
        </select>
        <Err name="unit_id" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">المستأجر *</label>
        <select name="tenant_id" required defaultValue={held("tenant_id", contract.tenant_id)} className={cls("tenant_id")}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <Err name="tenant_id" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">نوع العقد</label>
        <select name="contract_kind" defaultValue={held("contract_kind", contract.contract_kind)} className={ok}>
          <option value="residential">سكني (بدون ضريبة)</option>
          <option value="commercial">تجاري (ضريبة 15%)</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">دورية الدفع</label>
        <select name="payment_frequency" defaultValue={held("payment_frequency", contract.payment_frequency)} className={ok}>
          <option value="monthly">شهري</option>
          <option value="quarterly">ربع سنوي</option>
          <option value="semi_annual">نصف سنوي</option>
          <option value="annual">سنوي</option>
          <option value="one_time">دفعة واحدة</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">تاريخ البداية *</label>
        <input name="start_date" type="date" required defaultValue={held("start_date", contract.start_date)} className={cls("start_date")} />
        <Err name="start_date" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">تاريخ النهاية *</label>
        <input name="end_date" type="date" required defaultValue={held("end_date", contract.end_date)} className={cls("end_date")} />
        <Err name="end_date" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">الإيجار السنوي (ر.س) *</label>
        <input name="annual_rent" inputMode="decimal" required defaultValue={held("annual_rent", sar(contract.annual_rent_halalas))} className={cls("annual_rent")} />
        <Err name="annual_rent" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">التأمين (ر.س)</label>
        <input name="deposit" inputMode="decimal" defaultValue={held("deposit", sar(contract.deposit_halalas))} className={ok} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">رسوم الخدمات (ر.س)</label>
        <input name="service_fees" inputMode="decimal" defaultValue={held("service_fees", sar(contract.service_fees_halalas))} className={ok} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">اسم المحل التجاري</label>
        <input name="trade_name" defaultValue={held("trade_name", contract.trade_name)} className={ok} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">اسم الممثل</label>
        <input name="representative_name" defaultValue={held("representative_name", contract.representative_name)} className={ok} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">صفة الممثل</label>
        <input name="representative_capacity" defaultValue={held("representative_capacity", contract.representative_capacity)} className={ok} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">جوال الممثل</label>
        <input name="representative_phone" dir="ltr" defaultValue={held("representative_phone", contract.representative_phone)} className={ok + " text-right"} />
      </div>

      <details className="rounded-lg border border-neutral-200 sm:col-span-2 dark:border-neutral-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          بيانات منصة إيجار (اختياري)
        </summary>
        <div className="grid gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 dark:border-neutral-800">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium">رقم العقد في منصة إيجار</label>
            <input name="ejar_contract_number" dir="ltr" defaultValue={held("ejar_contract_number", contract.ejar_contract_number)} className={ok + " text-right"} />
          </div>
          <div className="sm:col-span-2 text-xs font-medium text-neutral-500">معلومات الوسيط العقاري</div>
          <div>
            <label className="mb-1 block text-sm font-medium">اسم المكتب</label>
            <input name="ejar_broker_office" defaultValue={held("ejar_broker_office", contract.ejar_broker_office)} className={ok} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">رقم المكتب</label>
            <input name="ejar_broker_number" dir="ltr" defaultValue={held("ejar_broker_number", contract.ejar_broker_number)} className={ok + " text-right"} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium">ممثل المكتب</label>
            <input name="ejar_broker_representative" defaultValue={held("ejar_broker_representative", contract.ejar_broker_representative)} className={ok} />
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">هل توجد بنود أو شروط إضافية في عقد منصة إيجار؟</legend>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="ejar_has_extra_terms" value="yes" defaultChecked={extraTerms === "yes"} className="accent-brand" /> نعم
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="ejar_has_extra_terms" value="no" defaultChecked={extraTerms === "no"} className="accent-brand" /> لا
              </label>
            </div>
          </fieldset>
        </div>
      </details>

      {state.error && !state.field && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="sm:col-span-2">
        <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60">
          {pending ? "جارٍ الحفظ…" : "حفظ تعديلات المسودة"}
        </button>
      </div>
    </form>
  );
}
