"use client";

import { useState } from "react";
import {
  ENTITY_TYPES,
  PERSON_ID_KINDS,
  UNIFIED_PATTERN,
  CR_PATTERN,
  VAT_PATTERN,
  isEstablishment,
  type PersonIdKind,
} from "@/lib/tenant-identity";

// Every tenant input, in one place. The create drawer and the edit page both render this, because
// which fields are required for which entity type is one rule and it may only be written once.
export type TenantDefaults = Partial<{
  display_name: string;
  tenant_type: string;
  phone: string;
  email: string;
  national_id: string;
  iqama_id: string;
  passport_no: string;
  unified_number: string;
  cr_number: string;
  vat_number: string;
  cr_expiry: string;
  rep_name: string;
  rep_id_number: string;
  rep_capacity: string;
  rep_phone: string;
  id_exempt_reason: string;
}>;

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";
const numCls = inputCls + " text-right";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {hint && <span className="mr-1 font-normal text-neutral-400">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function initialIdKind(d: TenantDefaults): PersonIdKind {
  if (d.iqama_id) return "iqama_id";
  if (d.passport_no) return "passport_no";
  return "national_id";
}

export function TenantFields({ defaults = {} }: { defaults?: TenantDefaults }) {
  const [tenantType, setTenantType] = useState(defaults.tenant_type ?? "individual");
  const [idKind, setIdKind] = useState<PersonIdKind>(initialIdKind(defaults));
  const [exempt, setExempt] = useState(Boolean(defaults.id_exempt_reason));
  const establishment = isEstablishment(tenantType);
  const idSpec = PERSON_ID_KINDS.find((k) => k.value === idKind)!;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium" htmlFor="display_name">
            {establishment ? "اسم المنشأة الرسمي *" : "اسم المستأجر *"}
          </label>
          <input id="display_name" name="display_name" required defaultValue={defaults.display_name ?? ""}
            placeholder="مثال: أحمد الشهري / شركة الراجحي" className={inputCls} />
        </div>

        <Field label="النوع">
          <select name="tenant_type" value={tenantType} onChange={(e) => setTenantType(e.target.value)} className={inputCls}>
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        <Field label="الجوال">
          <input name="phone" dir="ltr" defaultValue={defaults.phone ?? ""} placeholder="05XXXXXXXX" className={numCls} />
        </Field>
      </div>

      {/* The primary identifier: required, and the value the tenant search resolves on. */}
      <fieldset className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <legend className="px-1 text-sm font-semibold text-brand">
          {establishment ? "معرّف المنشأة" : "هوية المستأجر"}
        </legend>

        {establishment ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الرقم الموحّد *" hint="10 أرقام تبدأ بـ 7">
              <input name="unified_number" dir="ltr" inputMode="numeric" pattern={UNIFIED_PATTERN} required={!exempt}
                defaultValue={defaults.unified_number ?? ""} placeholder="7001234567" className={numCls} />
            </Field>
            <Field label="السجل التجاري" hint="10 أرقام">
              <input name="cr_number" dir="ltr" inputMode="numeric" pattern={CR_PATTERN}
                defaultValue={defaults.cr_number ?? ""} className={numCls} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نوع الهوية">
              <select name="id_kind" value={idKind} onChange={(e) => setIdKind(e.target.value as PersonIdKind)} className={inputCls}>
                {PERSON_ID_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </Field>
            <Field label={`رقم ${idSpec.label} *`} hint={idSpec.hint}>
              <input name="id_number" dir="ltr" pattern={idSpec.pattern} required={!exempt}
                defaultValue={defaults[idKind] ?? ""} className={numCls} />
            </Field>
          </div>
        )}

        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} className="accent-brand" />
          لا يوجد معرّف (جهة حكومية، سفارة، كيان أجنبي)
        </label>
        {exempt && (
          <input name="id_exempt_reason" required defaultValue={defaults.id_exempt_reason ?? ""}
            placeholder="اكتب سبب الإعفاء" className={inputCls + " mt-2"} />
        )}
      </fieldset>

      {/* For an establishment the person block describes the SIGNING REPRESENTATIVE, not the tenant. */}
      {establishment && (
        <fieldset className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <legend className="px-1 text-sm font-semibold text-brand">ممثل المنشأة</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الاسم *">
              <input name="rep_name" required={!exempt} defaultValue={defaults.rep_name ?? ""} className={inputCls} />
            </Field>
            <Field label="رقم الهوية *" hint="10 أرقام تبدأ بـ 1 أو 2">
              <input name="rep_id_number" dir="ltr" inputMode="numeric" pattern="^[12][0-9]{9}$" required={!exempt}
                defaultValue={defaults.rep_id_number ?? ""} className={numCls} />
            </Field>
            <Field label="الجوال *">
              <input name="rep_phone" dir="ltr" required={!exempt} defaultValue={defaults.rep_phone ?? ""}
                placeholder="05XXXXXXXX" className={numCls} />
            </Field>
            <Field label="الصفة">
              <input name="rep_capacity" defaultValue={defaults.rep_capacity ?? ""}
                placeholder="مثال: مدير عام / مفوّض" className={inputCls} />
            </Field>
          </div>
        </fieldset>
      )}

      <details className="rounded-lg border border-neutral-200 dark:border-neutral-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          تفاصيل إضافية (اختياري)
        </summary>
        <div className="grid gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 dark:border-neutral-800">
          <Field label="البريد الإلكتروني">
            <input name="email" type="email" dir="ltr" defaultValue={defaults.email ?? ""} className={numCls} />
          </Field>
          {establishment && (
            <>
              <Field label="الرقم الضريبي" hint="15 رقماً يبدأ وينتهي بـ 3">
                <input name="vat_number" dir="ltr" inputMode="numeric" pattern={VAT_PATTERN}
                  defaultValue={defaults.vat_number ?? ""} className={numCls} />
              </Field>
              <Field label="تاريخ انتهاء السجل">
                <input name="cr_expiry" type="date" dir="ltr" defaultValue={defaults.cr_expiry ?? ""} className={inputCls} />
              </Field>
            </>
          )}
        </div>
      </details>
    </>
  );
}
