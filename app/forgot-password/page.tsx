"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type ResetRequestState } from "../login/actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, {} as ResetRequestState);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">عقار</h1>
        <p className="text-neutral-600 dark:text-neutral-400">استعادة كلمة المرور</p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {state.sent ? (
          <div className="space-y-4 text-center">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              إن كان بريدك مسجّلاً لدينا، فقد أرسلنا إليه رابطاً لإعادة تعيين كلمة المرور. تحقّق من بريدك (وصندوق الرسائل غير المرغوبة).
            </p>
            <Link href="/login" className="text-sm text-brand hover:underline">
              العودة لتسجيل الدخول
            </Link>
          </div>
        ) : (
          <form action={action} className="space-y-4">
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
              className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-left outline-none focus:border-brand dark:border-neutral-700"
              required
            />
            {state.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                {state.error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
            >
              {pending ? "جارٍ الإرسال…" : "إرسال رابط الاستعادة"}
            </button>
            <div className="text-center">
              <Link href="/login" className="text-sm text-neutral-500 hover:underline">
                العودة لتسجيل الدخول
              </Link>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
