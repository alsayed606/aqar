"use client";

import { useActionState, useState } from "react";
import {
  useRecoveryCode,
  sendRecoveryEmailCode,
  verifyRecoveryEmailCode,
  type RecoveryState,
  type EmailChallengeState,
} from "@/app/auth/mfa/actions";

const noticeCls = "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300";
const errorCls = "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300";
const inputCls = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 text-center outline-none focus:border-brand dark:border-neutral-700";

/**
 * The way out of the authenticator screen, folded shut until asked for.
 *
 * Collapsed by default on purpose: the recovery paths must be findable by someone who is locked
 * out, and ignorable by the ninety-nine sign-ins where the phone is simply in the user's hand.
 */
export function MfaRecoveryOptions({ returnTo, hasEmail }: { returnTo: string; hasEmail: boolean }) {
  const [open, setOpen] = useState(false);
  const [codeState, useCode, spending] = useActionState<RecoveryState, FormData>(useRecoveryCode, {});
  const [sendState, send, sending] = useActionState<EmailChallengeState, FormData>(sendRecoveryEmailCode, {});
  const [mailState, verifyMail, verifying] = useActionState<EmailChallengeState, FormData>(verifyRecoveryEmailCode, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-center text-sm text-brand underline-offset-4 hover:underline"
      >
        فقدت جوالك أو تطبيق المصادقة؟
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div>
        <h2 className="text-sm font-semibold">استرداد الحساب</h2>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          استخدم رمزاً من قائمة الرموز الاحتياطية التي حفظتها عند التفعيل.
        </p>
      </div>

      <form action={useCode} className="space-y-2">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          name="code"
          autoComplete="off"
          dir="ltr"
          placeholder="XXXXX-XXXXX"
          aria-label="رمز الاسترداد"
          className={inputCls + " tracking-[0.2em]"}
          required
        />
        {codeState.error && <p className={errorCls}>{codeState.error}</p>}
        <button
          type="submit"
          disabled={spending}
          className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {spending ? "جارٍ التحقّق…" : "استخدام رمز احتياطي"}
        </button>
      </form>

      <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          لم تحفظ رموزاً احتياطية؟ نرسل رمزاً إلى بريد حسابك. هذا الطريق{" "}
          <b>أضعف من تطبيق المصادقة</b>، فيفتح لك صفحة الأمان فقط لإزالة التطبيق المفقود أو
          تسجيل غيره — لا بقية النظام.
        </p>

        {!hasEmail ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            لا يوجد بريد على حسابك، فلا يمكن إرسال رمز استرداد. تواصل معنا.
          </p>
        ) : !sendState.sent ? (
          <form action={send} className="mt-2">
            {sendState.error && <p className={errorCls + " mb-2"}>{sendState.error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {sending ? "جارٍ الإرسال…" : "أرسل رمز استرداد إلى بريدي"}
            </button>
          </form>
        ) : (
          <div className="mt-2 space-y-2">
            {sendState.notice && <p className={noticeCls}>{sendState.notice}</p>}
            <form action={verifyMail} className="space-y-2">
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                dir="ltr"
                placeholder="000000"
                aria-label="رمز الاسترداد المرسل بالبريد"
                className={inputCls + " text-lg tracking-[0.4em]"}
              />
              {mailState.error && <p className={errorCls}>{mailState.error}</p>}
              <button
                type="submit"
                disabled={verifying}
                className="w-full rounded-lg border border-brand px-4 py-2.5 font-medium text-brand hover:bg-brand/5 disabled:opacity-60"
              >
                {verifying ? "جارٍ التحقّق…" : "متابعة الاسترداد"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
