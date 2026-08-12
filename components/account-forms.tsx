"use client";

import { useActionState } from "react";
import { Field, FormError, fieldCls, inputCls, useSuccessToast } from "@/components/form-field";
import type { FormState as AccountFormState } from "@/lib/form-state";
import { changeEmail, changePassword, updateMyProfile } from "@/app/app/settings/actions";

// The account section of the settings page, as three independent forms.
//
// Each keeps its own state, so a failed password change does not blank the phone field beside it,
// and each error is rendered UNDER THE INPUT IT BELONGS TO. The page-wide banner these replaced sat
// at the top of a long page: a reader working in this section never saw it, and by the time they
// scrolled up the redirect had already discarded what they typed.

const initial: AccountFormState = {};

const button =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60";
const buttonOutline =
  "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800";

function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, action, pending] = useActionState(updateMyProfile, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="الاسم" name="full_name" state={state}>
        <input id="full_name" name="full_name" defaultValue={fullName} className={inputCls} />
      </Field>
      <Field
        label="جوال التواصل"
        name="phone"
        state={state}
        hint="تسجيل الدخول بالبريد وكلمة المرور — هذا الرقم للتواصل"
      >
        <input
          id="phone"
          name="phone"
          dir="ltr"
          inputMode="tel"
          placeholder="05XXXXXXXX"
          defaultValue={phone}
          className={fieldCls(state, "phone") + " text-start"}
        />
      </Field>
      <div className="sm:col-span-2 space-y-2">
        <FormError state={state} />
        <button type="submit" disabled={pending} className={button}>
          {pending ? "جارٍ الحفظ…" : "حفظ بياناتي"}
        </button>
      </div>
    </form>
  );
}

function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changeEmail, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 dark:border-slate-800">
      <Field
        label="البريد الإلكتروني"
        name="email"
        state={state}
        hint="تغييره يتطلّب فتح رابط التأكيد من البريد الجديد"
      >
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          defaultValue={email}
          className={fieldCls(state, "email") + " text-start"}
        />
      </Field>
      <div className="flex items-end">
        <button type="submit" disabled={pending} className={buttonOutline}>
          {pending ? "جارٍ الإرسال…" : "تغيير البريد"}
        </button>
      </div>
      <div className="sm:col-span-2"><FormError state={state} /></div>
    </form>
  );
}

function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 dark:border-slate-800">
      <Field label="كلمة المرور الحالية" name="current_password" state={state}>
        <input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          className={fieldCls(state, "current_password")}
        />
      </Field>
      <Field label="كلمة المرور الجديدة" name="new_password" state={state} hint="٨ أحرف على الأقل">
        <input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={fieldCls(state, "new_password")}
        />
      </Field>
      <div className="sm:col-span-2 space-y-2">
        <FormError state={state} />
        <button type="submit" disabled={pending} className={buttonOutline}>
          {pending ? "جارٍ التغيير…" : "تغيير كلمة المرور"}
        </button>
      </div>
    </form>
  );
}

export function AccountForms({
  fullName,
  phone,
  email,
}: {
  fullName: string;
  phone: string;
  email: string;
}) {
  return (
    <>
      <ProfileForm fullName={fullName} phone={phone} />
      <EmailForm email={email} />
      <PasswordForm />
    </>
  );
}
