"use client";

import { useActionState, useState } from "react";
import {
  generateRecoveryCodesAction,
  type RecoveryCodesState,
} from "@/app/app/security/actions";

/**
 * The sheet of ten, shown exactly once.
 *
 * Everything on this screen follows from that: the codes are rendered from the action's return
 * value and never re-fetched, the copy/download buttons exist because a code the user cannot get
 * out of the browser is a code they will not have on the day they need it, and regenerating says
 * out loud that the previous sheet dies.
 */
export function RecoveryCodes({ codesLeft, hasFactor }: { codesLeft: number; hasFactor: boolean }) {
  const [state, generate, pending] = useActionState<RecoveryCodesState, FormData>(
    generateRecoveryCodesAction,
    {},
  );
  const [copied, setCopied] = useState(false);

  const codes = state.codes;
  const text = codes?.join("\n") ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    // A data: URL rather than a fetch — the codes must not leave the browser to come back as a file.
    const url = URL.createObjectURL(new Blob([`رموز استرداد عقار\n\n${text}\n`], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "aqar-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (codes) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <b>احفظها الآن.</b> لن تظهر مرّة أخرى — نحن لا نحتفظ إلا ببصمتها، فلا يمكننا عرضها لك لاحقاً.
          كل رمز يُستخدم مرّة واحدة.
        </p>
        <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950">
          {codes.map((c) => (
            <li key={c} className="tracking-widest">{c}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {copied ? "✓ نُسخت" : "نسخ"}
          </button>
          <button
            type="button"
            onClick={download}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            تنزيل كملف
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      {codesLeft > 0 ? (
        <p className={
          codesLeft <= 3
            ? "rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
            : "text-sm text-neutral-600 dark:text-neutral-400"
        }>
          {codesLeft <= 3
            ? `لم يتبقَّ سوى ${codesLeft} من رموز الاسترداد. ولّد قائمة جديدة قبل أن تنفد.`
            : `متبقٍّ ${codesLeft} من ١٠ رموز غير مستخدمة.`}
        </p>
      ) : hasFactor ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <b>لا توجد رموز استرداد على حسابك.</b> إن فقدت وسيلة التحقّق فلن يكون أمامك إلا الطريق
          الأضعف. ولّدها الآن — دقيقة واحدة.
        </p>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          فعّل إحدى وسيلتي التحقّق أعلاه أوّلاً، ثم ولّد رموز الاسترداد.
        </p>
      )}

      {hasFactor && (
        <form action={generate}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-60"
          >
            {pending ? "جارٍ التوليد…" : codesLeft > 0 ? "توليد قائمة جديدة (تُلغي القديمة)" : "توليد رموز الاسترداد"}
          </button>
        </form>
      )}
    </div>
  );
}
