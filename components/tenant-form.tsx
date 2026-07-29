"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createTenant, type TenantState } from "@/app/app/tenants/actions";
import { useFormDrawerClose } from "@/components/form-drawer";

const initial: TenantState = {};

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

export function TenantForm() {
  const [state, action, pending] = useActionState(createTenant, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [tenantType, setTenantType] = useState("individual");
  const isEstablishment = tenantType !== "individual";
  const closeDrawer = useFormDrawerClose();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setTenantType("individual");
      closeDrawer?.();
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {/* Minimal primary fields: name, type, phone. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium" htmlFor="display_name">
            {isEstablishment ? "اسم المنشأة الرسمي *" : "اسم المستأجر *"}
          </label>
          <input id="display_name" name="display_name" required placeholder="مثال: أحمد الشهري / شركة الراجحي" className={inputCls} />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="tenant_type">
            النوع
          </label>
          <select
            id="tenant_type"
            name="tenant_type"
            value={tenantType}
            onChange={(e) => setTenantType(e.target.value)}
            className={inputCls}
          >
            <option value="individual">فرد</option>
            <option value="sole_establishment">مؤسسة فردية</option>
            <option value="company">شركة</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="phone">
            الجوال
          </label>
          <input id="phone" name="phone" dir="ltr" placeholder="05XXXXXXXX" className={inputCls + " text-right"} />
        </div>
      </div>

      {/* Everything else is optional and tucked away so the first entry stays fast. */}
      <details className="rounded-lg border border-neutral-200 dark:border-neutral-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          تفاصيل إضافية (اختياري)
        </summary>
        <div className="grid gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 dark:border-neutral-800">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="national_id">
              رقم الهوية / الإقامة
            </label>
            <input id="national_id" name="national_id" dir="ltr" className={inputCls + " text-right"} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              البريد الإلكتروني
            </label>
            <input id="email" name="email" type="email" dir="ltr" className={inputCls + " text-right"} />
          </div>

          {isEstablishment && (
            <>
              <div className="sm:col-span-2 mt-1 text-xs font-medium text-neutral-500">بيانات المنشأة</div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="cr_number">
                  السجل التجاري
                </label>
                <input id="cr_number" name="cr_number" dir="ltr" className={inputCls + " text-right"} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="unified_number">
                  الرقم الموحّد <span className="text-neutral-400">(اختياري)</span>
                </label>
                <input id="unified_number" name="unified_number" dir="ltr" className={inputCls + " text-right"} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="vat_number">
                  الرقم الضريبي <span className="text-neutral-400">(اختياري)</span>
                </label>
                <input id="vat_number" name="vat_number" dir="ltr" className={inputCls + " text-right"} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="cr_expiry">
                  تاريخ انتهاء السجل <span className="text-neutral-400">(اختياري)</span>
                </label>
                <input id="cr_expiry" name="cr_expiry" type="date" dir="ltr" className={inputCls} />
              </div>
            </>
          )}
        </div>
      </details>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {pending ? "جارٍ الحفظ…" : "إضافة المستأجر"}
      </button>
    </form>
  );
}
