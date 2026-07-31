"use client";

import { useState } from "react";
import { extendTrial, changePlan, suspendTenant, reactivateTenant } from "@/app/platform/actions";

// The operator levers for one office, behind a (⋮) menu so a table row stays readable.
//
// What is offered depends on the office's current state — a trial extension means nothing for an
// active subscription, and "reactivate" means nothing for one that is already running. Showing a
// lever that cannot apply invites a click that ends in an error message.
//
// Suspension asks for a reason inline and will not submit without one: it cuts a paying customer
// off, and the reason is what a future operator reads in the audit log to understand why.

const PLAN_LABEL: Record<string, string> = { basic: "الأساسية", pro: "الاحترافية", enterprise: "المؤسسية" };
const itemCls = "block w-full rounded-lg px-3 py-2 text-right text-sm hover:bg-slate-100 dark:hover:bg-slate-800";

export function TenantActions({
  orgId,
  status,
  planCode,
  back,
}: {
  orgId: string;
  status: string | null;
  planCode: string | null;
  back: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);

  const isTrialing = status === "trialing";
  const canReactivate = status === "suspended" || status === "canceled" || status === "past_due";
  const otherPlans = ["basic", "pro", "enterprise"].filter((p) => p !== planCode);

  const hidden = (
    <>
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="back" value={back} />
    </>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="إجراءات المكتب"
        aria-expanded={open}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute end-0 z-20 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {isTrialing && (
              <>
                {[14, 30].map((days) => (
                  <form key={days} action={extendTrial}>
                    {hidden}
                    <input type="hidden" name="days" value={days} />
                    <button className={itemCls}>تمديد التجربة {days} يوماً</button>
                  </form>
                ))}
                <hr className="my-1 border-slate-100 dark:border-slate-800" />
              </>
            )}

            {otherPlans.map((plan) => (
              <form key={plan} action={changePlan}>
                {hidden}
                <input type="hidden" name="plan" value={plan} />
                <button className={itemCls}>نقل إلى الخطة {PLAN_LABEL[plan]}</button>
              </form>
            ))}

            <hr className="my-1 border-slate-100 dark:border-slate-800" />

            {canReactivate && (
              <form action={reactivateTenant}>
                {hidden}
                <button className={itemCls + " text-emerald-700 dark:text-emerald-400"}>إعادة التفعيل</button>
              </form>
            )}

            {status !== "suspended" &&
              (confirmingSuspend ? (
                <form action={suspendTenant} className="space-y-2 p-2">
                  {hidden}
                  <label className="block text-xs text-slate-500">
                    سبب الإيقاف (يُسجَّل في التدقيق)
                    <input
                      name="reason"
                      required
                      autoFocus
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
                    />
                  </label>
                  <button className="w-full rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
                    تأكيد الإيقاف
                  </button>
                </form>
              ) : (
                <button type="button" onClick={() => setConfirmingSuspend(true)} className={itemCls + " text-red-600 dark:text-red-400"}>
                  إيقاف الحساب…
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
