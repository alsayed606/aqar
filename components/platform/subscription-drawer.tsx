"use client";

import { useState } from "react";
import { setSubscription } from "@/app/platform/actions";
import { fmtDate } from "@/lib/subscription";
import { SUBSCRIPTION_STATUS_AR } from "@/lib/labels";
import { Button, Drawer } from "@/components/ui";

const PLANS = ["basic", "pro", "enterprise"];
const STATUSES = ["trialing", "active", "comped", "past_due", "canceled"];

type Org = {
  org_id: string;
  org_name: string;
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700";

// In-line subscription editor for the tenant list: opens a slide-over instead of navigating away.
// setSubscription redirects back to the list (the `back` field), reloading it with the new values.
export function SubscriptionDrawer({ org }: { org: Org }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-brand">
        تعديل
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`اشتراك: ${org.org_name}`}>
        <form action={setSubscription} className="space-y-4">
          <input type="hidden" name="org_id" value={org.org_id} />
          <input type="hidden" name="back" value="/platform/tenants" />
          <p className="text-xs text-slate-500">اترك الحقل فارغاً لإبقاء قيمته الحالية.</p>

          <label className="block text-sm">
            الخطة <span className="text-slate-400">(الحالية: {org.plan_code ?? "—"})</span>
            <select name="plan" defaultValue="" className={fieldCls}>
              <option value="">— بدون تغيير —</option>
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          <label className="block text-sm">
            الحالة <span className="text-slate-400">(الحالية: {org.status ? SUBSCRIPTION_STATUS_AR[org.status] ?? org.status : "—"})</span>
            <select name="status" defaultValue="" className={fieldCls}>
              <option value="">— بدون تغيير —</option>
              {STATUSES.map((s) => <option key={s} value={s}>{SUBSCRIPTION_STATUS_AR[s] ?? s}</option>)}
            </select>
          </label>

          <label className="block text-sm">
            نهاية التجربة <span className="text-slate-400" dir="ltr">({fmtDate(org.trial_ends_at)})</span>
            <input type="date" name="trial_ends_at" dir="ltr" className={fieldCls} />
          </label>

          <label className="block text-sm">
            نهاية الفترة <span className="text-slate-400" dir="ltr">({fmtDate(org.current_period_end)})</span>
            <input type="date" name="period_end" dir="ltr" className={fieldCls} />
          </label>

          <label className="block text-sm">
            ملاحظة (سبب المنح/التمديد)
            <input name="notes" className={fieldCls} />
          </label>

          <Button type="submit" className="w-full">حفظ التغييرات</Button>
        </form>
      </Drawer>
    </>
  );
}
