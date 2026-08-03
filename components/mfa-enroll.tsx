"use client";

import { useActionState, useState } from "react";
import { startEnrollment, confirmEnrollment, type EnrollState, type VerifyState } from "@/app/app/security/actions";

const initialVerify: VerifyState = {};

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-center tracking-[0.4em] outline-none focus:border-brand dark:border-neutral-700";

export function MfaEnroll() {
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [starting, setStarting] = useState(false);
  const [state, action, pending] = useActionState(confirmEnrollment, initialVerify);

  async function begin() {
    setStarting(true);
    setEnroll(await startEnrollment());
    setStarting(false);
  }

  if (!enroll?.factorId) {
    return (
      <div>
        <button
          type="button"
          onClick={begin}
          disabled={starting}
          className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {starting ? "جارٍ التجهيز…" : "تفعيل التحقّق بخطوتين"}
        </button>
        {enroll?.error && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {enroll.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-inside list-decimal space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
        <li>افتح تطبيق مصادقة مثل Google Authenticator أو Microsoft Authenticator.</li>
        <li>امسح الرمز أدناه، أو أدخل المفتاح يدوياً.</li>
        <li>اكتب الرمز المكوّن من ٦ أرقام الذي يعرضه التطبيق.</li>
      </ol>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        {/* Generated locally by the server action from the TOTP uri — not third-party markup. */}
        <div className="[&>svg]:h-48 [&>svg]:w-48" dangerouslySetInnerHTML={{ __html: enroll.qrSvg ?? "" }} />
        {enroll.secret && (
          <div className="text-center">
            <p className="text-xs text-neutral-500">أو أدخل هذا المفتاح يدوياً:</p>
            <code dir="ltr" className="mt-1 block select-all break-all rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
              {enroll.secret}
            </code>
          </div>
        )}
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="factor_id" value={enroll.factorId} />
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="code">رمز التحقّق</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            dir="ltr"
            placeholder="000000"
            className={inputCls}
          />
        </div>

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
          {pending ? "جارٍ التحقّق…" : "تأكيد التفعيل"}
        </button>
      </form>
    </div>
  );
}
