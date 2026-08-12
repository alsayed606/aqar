"use client";

import { useActionState, useEffect } from "react";
import { useToast } from "@/components/ui";
import {
  changeEmail,
  changePassword,
  updateMyProfile,
  type AccountFormState,
} from "@/app/app/settings/actions";

// The account section of the settings page, as three independent forms.
//
// Each keeps its own state, so a failed password change does not blank the phone field beside it,
// and each error is rendered UNDER THE INPUT IT BELONGS TO. The page-wide banner these replaced sat
// at the top of a long page: a reader working in this section never saw it, and by the time they
// scrolled up the redirect had already discarded what they typed.

const initial: AccountFormState = {};

const input =
  "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700";
const inputBad = "w-full rounded-lg border border-red-400 bg-transparent px-3 py-2 text-sm outline-none dark:border-red-500";

/** Success is transient and needs no action, so it goes to a toast rather than staying on screen. */
function useSuccessToast(state: AccountFormState) {
  const { toast } = useToast();
  useEffect(() => {
    if (state.ok) toast({ title: state.ok, tone: "success" });
  }, [state.ok, toast]);
}

function Field({
  label,
  hint,
  name,
  state,
  children,
}: {
  label: string;
  hint?: string;
  name: string;
  state: AccountFormState;
  children: React.ReactNode;
}) {
  const message = state.field === name ? state.error : null;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor={name}>{label}</label>
      {children}
      {message ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{message}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}

/** An error with no field of its own — a throttle, or something the whole form failed at. */
function FormError({ state }: { state: AccountFormState }) {
  if (!state.error || state.field) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      {state.error}
    </p>
  );
}

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
        <input id="full_name" name="full_name" defaultValue={fullName} className={input} />
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
          className={(state.field === "phone" ? inputBad : input) + " text-start"}
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
          className={(state.field === "email" ? inputBad : input) + " text-start"}
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
          className={state.field === "current_password" ? inputBad : input}
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
          className={state.field === "new_password" ? inputBad : input}
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
