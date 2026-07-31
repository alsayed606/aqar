"use client";

import { useActionState, useEffect, useState } from "react";
import { previewBroadcast, sendBroadcast, type BroadcastResult } from "@/app/platform/actions";
import { SUBSCRIPTION_STATUS_AR } from "@/lib/labels";
import { Button } from "@/components/ui";

// Composing a broadcast is deliberately two steps. The first counts the audience and writes
// nothing; only after the operator has SEEN the number does the send button exist, and it still
// needs the confirmation box ticked. This is the least reversible thing in the console — there is
// no unsend — so the friction is the feature.
//
// Changing any field after a preview clears it: a count taken for "past-due offices" must never
// stay on screen while the audience quietly says "everyone".

const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700";
const empty: BroadcastResult = { ok: false };

export function BroadcastComposer({ plans }: { plans: { code: string; name_ar: string }[] }) {
  const [preview, runPreview, previewing] = useActionState(previewBroadcast, empty);
  const [sent, runSend, sending] = useActionState(sendBroadcast, empty);
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // A fresh count clears the dirty flag that the last keystroke before submitting had set.
  useEffect(() => {
    if (preview.ok) setDirty(false);
  }, [preview]);

  const counted = preview.ok && !dirty;
  const invalidate = () => {
    setDirty(true);
    setConfirmed(false);
  };

  return (
    <form className="space-y-4" onChange={invalidate}>
      <label className="block text-sm">
        العنوان
        <input name="title" required maxLength={120} className={fieldCls} />
      </label>

      <label className="block text-sm">
        النص
        <textarea name="body" rows={4} className={fieldCls} />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          حالة الاشتراك
          <select name="status" className={fieldCls} defaultValue="">
            <option value="">كل الحالات</option>
            {["trialing", "active", "comped", "past_due", "suspended", "canceled"].map((s) => (
              <option key={s} value={s}>{SUBSCRIPTION_STATUS_AR[s] ?? s}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          الخطة
          <select name="plan" className={fieldCls} defaultValue="">
            <option value="">كل الخطط</option>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name_ar}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          القناة
          <select name="channel" className={fieldCls} defaultValue="in_app">
            <option value="in_app">داخل التطبيق فقط</option>
            <option value="in_app_email">داخل التطبيق + بريد</option>
          </select>
        </label>
      </div>

      {(preview.error || sent.error) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {preview.error ?? sent.error}
        </p>
      )}

      {sent.ok && sent.sent && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          أُرسل إلى {sent.orgs} مكتب{sent.emails ? ` · ${sent.emails} رسالة بريد في الطابور` : ""}.
        </p>
      )}

      {counted && !sent.sent && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-900/20">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            سيصل هذا إلى <b>{preview.orgs}</b> مكتب
            {preview.emails ? <> و<b>{preview.emails}</b> صندوق بريد</> : null}.
            {preview.emails ? " الرسائل تدخل الطابور ويُصرّفها المُصرِّف المجدول." : ""}
          </p>
          <label className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            أؤكد الإرسال. لا يمكن التراجع.
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" formAction={runPreview} disabled={previewing}>
          {previewing ? "…جارٍ الحساب" : counted ? "إعادة حساب الجمهور" : "معاينة الجمهور"}
        </Button>
        {counted && !sent.sent && (
          <Button type="submit" formAction={runSend} disabled={!confirmed || sending}>
            {sending ? "…جارٍ الإرسال" : `إرسال إلى ${preview.orgs} مكتب`}
          </Button>
        )}
      </div>
    </form>
  );
}
