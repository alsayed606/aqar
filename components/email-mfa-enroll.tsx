"use client";

import { useActionState } from "react";
import {
  startEmailEnrollment,
  confirmEmailEnrollment,
  type EmailEnrollState,
} from "@/app/app/security/actions";

const initial: EmailEnrollState = {};
const errorCls = "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300";

/** Enrolling the e-mail factor: ask for a code, then prove it arrived. */
export function EmailMfaEnroll({ masked }: { masked: string }) {
  const [sendState, send, sending] = useActionState(startEmailEnrollment, initial);
  const [confirmState, confirm, confirming] = useActionState(confirmEmailEnrollment, initial);

  if (!sendState.sent) {
    return (
      <form action={send} className="space-y-2">
        <button
          type="submit"
          disabled={sending}
          className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {sending ? "جارٍ الإرسال…" : "تفعيل — أرسل رمزاً إلى بريدي"}
        </button>
        <p className="text-xs text-neutral-500">سيصل الرمز إلى {masked}.</p>
        {sendState.error && <p className={errorCls}>{sendState.error}</p>}
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
        أُرسل رمز من ستّة أرقام إلى {sendState.masked ?? masked}. أدخله أدناه خلال عشر دقائق.
      </p>

      <form action={confirm} className="space-y-3">
        <input type="hidden" name="masked" value={sendState.masked ?? masked} />
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="email-otp">رمز التحقّق</label>
          <input
            id="email-otp"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            dir="ltr"
            placeholder="000000"
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-center tracking-[0.4em] outline-none focus:border-brand dark:border-neutral-700"
          />
        </div>

        {confirmState.error && <p className={errorCls}>{confirmState.error}</p>}

        <button
          type="submit"
          disabled={confirming}
          className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {confirming ? "جارٍ التحقّق…" : "تأكيد التفعيل"}
        </button>
      </form>

      <form action={send}>
        <button
          type="submit"
          disabled={sending}
          className="text-sm text-brand underline-offset-2 hover:underline disabled:opacity-60"
        >
          {sending ? "جارٍ الإرسال…" : "لم يصلني — أرسل رمزاً جديداً"}
        </button>
      </form>
    </div>
  );
}
