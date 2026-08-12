"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { FilePicker } from "@/components/file-picker";
import { Field, FormError, fieldCls, useSuccessToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { updateOrgProfile, uploadOrgLogo, removeOrgLogo } from "@/app/app/settings/actions";

// The organization's identity, and its logo. Fifteen inputs, where a refusal used to arrive as one
// line at the top of a long page — a message the office had to hunt for, on a form it had to retype.

const initial: FormState = {};

export function OrgProfileForm({
  org,
  addressLine,
}: {
  org: Record<string, string | null>;
  addressLine: string | null;
}) {
  const [state, action, pending] = useActionState(updateOrgProfile, initial);
  useSuccessToast(state);

  // Every input is the same three things — its name, its stored value, and the border that turns red
  // when the name matches the refusal. Spelling that out fifteen times is where a typo hides.
  const text = (name: string) => ({
    id: name,
    name,
    defaultValue: org[name] ?? "",
    className: fieldCls(state, name),
  });
  const ltr = (name: string) => ({ ...text(name), dir: "ltr" as const, className: fieldCls(state, name) + " text-start" });
  const digits = (name: string) => ({ ...ltr(name), inputMode: "numeric" as const });

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم المنشأة *" name="name" state={state}>
          <input required {...text("name")} />
        </Field>
        <Field label="السجل التجاري" name="cr_number" state={state} hint="١٠ أرقام">
          <input {...digits("cr_number")} />
        </Field>
        <Field label="الرقم الضريبي" name="vat_number" state={state} hint="١٥ رقماً، يبدأ بـ ٣ وينتهي بـ ٣">
          <input {...digits("vat_number")} />
        </Field>
        <Field label="رقم ترخيص فال" name="fal_license_no" state={state}>
          <input {...digits("fal_license_no")} />
        </Field>
        <Field label="هاتف المكتب" name="contact_phone" state={state} hint="ثابت أو جوال — كما تريده مطبوعاً">
          <input {...ltr("contact_phone")} />
        </Field>
        <Field label="بريد المكتب" name="contact_email" state={state}>
          <input type="email" {...ltr("contact_email")} />
        </Field>
      </div>

      <fieldset className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
        <legend className="text-sm font-semibold">العنوان الوطني</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="رقم المبنى" name="address_building_no" state={state} hint="٤ أرقام">
            <input {...digits("address_building_no")} />
          </Field>
          <Field label="الشارع" name="address_street" state={state}>
            <input {...text("address_street")} />
          </Field>
          <Field label="الحي" name="address_district" state={state}>
            <input {...text("address_district")} />
          </Field>
          <Field label="المدينة" name="address_city" state={state}>
            <input {...text("address_city")} />
          </Field>
          <Field label="الرمز البريدي" name="address_postal_code" state={state} hint="٥ أرقام">
            <input {...digits("address_postal_code")} />
          </Field>
          <Field label="الرقم الإضافي" name="address_additional_no" state={state} hint="٤ أرقام">
            <input {...digits("address_additional_no")} />
          </Field>
        </div>
        {addressLine && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            سيُطبع هكذا: <span className="font-medium">{addressLine}</span>
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
        <legend className="text-sm font-semibold">الحساب البنكي للتحصيل</legend>
        <p className="text-xs text-slate-500">
          حساب مكتبك الذي يُحوّل إليه المستأجرون. لا يُستخدم لأي تحويل يجريه النظام — النظام لا يحوّل أموالاً.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم البنك" name="bank_name" state={state}>
            <input {...text("bank_name")} />
          </Field>
          <Field label="اسم صاحب الحساب" name="bank_account_name" state={state}>
            <input {...text("bank_account_name")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="الآيبان" name="iban" state={state} hint="يبدأ بـ SA ويتكوّن من ٢٤ خانة">
              <input
                {...ltr("iban")}
                placeholder="SA0000000000000000000000"
                className={fieldCls(state, "iban") + " text-start font-mono"}
              />
            </Field>
          </div>
        </div>
      </fieldset>

      <FormError state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "جارٍ الحفظ…" : "حفظ بيانات المنشأة"}
      </Button>
    </form>
  );
}

/** Upload and remove: two actions, two states, so one's refusal never speaks for the other. */
export function OrgLogoForms({ hasLogo }: { hasLogo: boolean }) {
  const [uploadState, upload, uploading] = useActionState(uploadOrgLogo, initial);
  const [removeState, remove, removing] = useActionState(removeOrgLogo, initial);
  useSuccessToast(uploadState);
  useSuccessToast(removeState);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={upload} className="flex flex-wrap items-center gap-3">
          <FilePicker name="logo" accept="image/png,image/jpeg,image/webp" required />
          <Button type="submit" variant="outline" disabled={uploading}>
            {uploading ? "جارٍ الرفع…" : "رفع الشعار"}
          </Button>
        </form>
        {hasLogo && (
          <form action={remove}>
            <Button
              type="submit"
              variant="ghost"
              disabled={removing}
              className="text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {removing ? "جارٍ الإزالة…" : "إزالة"}
            </Button>
          </form>
        )}
      </div>
      <FormError state={uploadState} />
      <FormError state={removeState} />
    </div>
  );
}
