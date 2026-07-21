"use client";

import { useActionState } from "react";
import { sendOtp, verifyOtp, type LoginState } from "./actions";

const initial: LoginState = { step: "phone" };

export default function LoginPage() {
  const [sendState, sendAction, sending] = useActionState(sendOtp, initial);
  const [verifyState, verifyAction, verifying] = useActionState(verifyOtp, {
    step: "code",
  } as LoginState);

  const onCodeStep = sendState.step === "code";
  const phone = sendState.phone ?? "";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">عقار</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          {onCodeStep ? "أدخل رمز التحقق المُرسل إلى جوالك" : "سجّل الدخول برقم جوالك"}
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {!onCodeStep ? (
          <form action={sendAction} className="space-y-4">
            <label className="block text-sm font-medium" htmlFor="phone">
              رقم الجوال
            </label>
            <input
              id="phone"
              name="phone"
              inputMode="tel"
              dir="ltr"
              placeholder="05XXXXXXXX"
              className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-left outline-none focus:border-brand dark:border-neutral-700"
              required
            />
            {sendState.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                {sendState.error}
              </p>
            )}
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
            >
              {sending ? "جارٍ الإرسال…" : "إرسال رمز التحقق"}
            </button>
          </form>
        ) : (
          <form action={verifyAction} className="space-y-4">
            <input type="hidden" name="phone" value={phone} />
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              أُرسل الرمز إلى <span dir="ltr">{phone}</span>
            </p>
            <label className="block text-sm font-medium" htmlFor="code">
              رمز التحقق
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              dir="ltr"
              maxLength={6}
              placeholder="______"
              className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand dark:border-neutral-700"
              required
            />
            {verifyState.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                {verifyState.error}
              </p>
            )}
            <button
              type="submit"
              disabled={verifying}
              className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
            >
              {verifying ? "جارٍ التحقق…" : "دخول"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
