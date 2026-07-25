"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { emailAuth, resendConfirmation, type EmailAuthState } from "./actions";

// returnTo is the validated, app-internal path to land on after login (default /app). It rides as a
// hidden field so it survives the round-trip. The active path is email + password (Sprint E); phone
// OTP is retained in the server actions but intentionally not surfaced here.
export function LoginForm({
  returnTo,
  initialError,
  initialNotice,
}: {
  returnTo: string;
  initialError?: string;
  initialNotice?: string;
}) {
  const [state, formAction, pending] = useActionState(emailAuth, {
    mode: "signin",
    error: initialError,
    notice: initialNotice,
  } as EmailAuthState);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const isSignup = mode === "signup";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">عقار</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          {isSignup ? "أنشئ حساب مكتبك بالبريد الإلكتروني" : "سجّل الدخول بالبريد الإلكتروني"}
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {/* Sign-in / sign-up toggle */}
        <div className="mb-5 grid grid-cols-2 rounded-lg bg-neutral-100 p-1 text-sm dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={"rounded-md py-1.5 font-medium transition " + (!isSignup ? "bg-white shadow-sm dark:bg-neutral-900" : "text-neutral-500")}
          >
            دخول
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={"rounded-md py-1.5 font-medium transition " + (isSignup ? "bg-white shadow-sm dark:bg-neutral-900" : "text-neutral-500")}
          >
            حساب جديد
          </button>
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="mode" value={mode} />

          {isSignup && (
            <div>
              <label className="block text-sm font-medium" htmlFor="full_name">
                الاسم <span className="text-neutral-400">(اختياري)</span>
              </label>
              <input
                id="full_name"
                name="full_name"
                autoComplete="name"
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium" htmlFor="email">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@example.com"
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-left outline-none focus:border-brand dark:border-neutral-700"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="password">
              كلمة المرور
            </label>
            <input
              id="password"
              name="password"
              type="password"
              dir="ltr"
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder="********"
              minLength={8}
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-left outline-none focus:border-brand dark:border-neutral-700"
              required
            />
            {isSignup && (
              <p className="mt-1 text-xs text-neutral-500">٨ أحرف على الأقل.</p>
            )}
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {state.error}
            </p>
          )}
          {state.notice && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              {state.notice}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
          >
            {pending ? "جارٍ المعالجة…" : isSignup ? "إنشاء الحساب" : "دخول"}
          </button>

          {!isSignup && (
            <div className="flex items-center justify-between pt-1 text-sm">
              <Link href="/forgot-password" className="text-neutral-500 hover:text-brand hover:underline">
                نسيت كلمة المرور؟
              </Link>
              {/* Resends the confirmation email using the entered address (once confirmation is on). */}
              <button
                type="submit"
                formAction={resendConfirmation}
                className="text-neutral-500 hover:text-brand hover:underline"
              >
                إعادة إرسال التأكيد
              </button>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
