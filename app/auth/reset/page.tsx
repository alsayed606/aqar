"use client";

import { useActionState } from "react";
import { updatePassword, type ResetState } from "../../login/actions";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState(updatePassword, {} as ResetState);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">عقار</h1>
        <p className="text-neutral-600 dark:text-neutral-400">تعيين كلمة مرور جديدة</p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <form action={action} className="space-y-4">
          <label className="block text-sm font-medium" htmlFor="password">
            كلمة المرور الجديدة
          </label>
          <input
            id="password"
            name="password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            placeholder="********"
            minLength={8}
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-left outline-none focus:border-brand dark:border-neutral-700"
            required
          />
          <p className="text-xs text-neutral-500">٨ أحرف على الأقل.</p>
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
            {pending ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
          </button>
        </form>
      </section>
    </main>
  );
}
