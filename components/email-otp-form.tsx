"use client";

import { useActionState } from "react";
import {
  sendStepUpCode,
  verifyEmailChallenge,
  abandonChallenge,
  type EmailChallengeState,
} from "@/app/auth/mfa/actions";

const initial: EmailChallengeState = {};

const noticeCls = "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300";
const errorCls = "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300";

/**
 * The step-up screen for the e-mail factor.
 *
 * The code is sent on an explicit click rather than on page load: a page can be refreshed, opened
 * twice, or prefetched, and each of those would otherwise mail the user another code.
 */
export function EmailOtpForm({ returnTo, masked }: { returnTo: string; masked: string }) {
  const [sendState, send, sending] = useActionState(sendStepUpCode, initial);
  const [verifyState, verify, verifying] = useActionState(verifyEmailChallenge, initial);

  return (
    <div className="space-y-3">
      <form action={send}>
        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {sending ? "جارٍ الإرسال…" : sendState.sent ? "إرسال رمز جديد" : `أرسل الرمز إلى ${masked}`}
        </button>
      </form>

      {sendState.notice && <p className={noticeCls}>{sendState.notice}</p>}
      {sendState.error && <p className={errorCls}>{sendState.error}</p>}

      <form action={verify} className="space-y-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          dir="ltr"
          placeholder="000000"
          aria-label="رمز التحقّق"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-brand dark:border-neutral-700"
        />

        {verifyState.error && <p className={errorCls}>{verifyState.error}</p>}

        <button
          type="submit"
          disabled={verifying}
          className="w-full rounded-lg border border-brand px-4 py-2.5 font-medium text-brand hover:bg-brand/5 disabled:opacity-60"
        >
          {verifying ? "جارٍ التحقّق…" : "تأكيد"}
        </button>
      </form>

      {/* The only way out. Without it, a user who cannot reach that inbox right now is stuck on a
          page whose every other control refuses them. */}
      <form action={abandonChallenge}>
        <button className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          تسجيل الخروج
        </button>
      </form>
    </div>
  );
}
