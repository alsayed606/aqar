import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { fmtDate } from "@/lib/subscription";
import { SUBSCRIPTION_STATUS_AR, SUBSCRIPTION_STATUS_TONE, SUBSCRIPTION_EVENT_AR } from "@/lib/labels";
import { Badge } from "@/components/ui";
import { UsageMeter } from "@/components/usage-meter";
import type { PlatformOrgRow, SubscriptionEventRow } from "@/lib/platform";
import { setSubscription } from "../../actions";

export const dynamic = "force-dynamic";

type PaymentRow = {
  id: string;
  plan_code: string;
  amount_halalas: number;
  status: string;
  gateway_payment_id: string | null;
  created_at: string;
  paid_at: string | null;
};

const PLANS = ["basic", "pro", "enterprise"];
const STATUSES = ["trialing", "active", "comped", "past_due", "canceled"];
const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700";

export default async function PlatformTenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { orgId } = await params;
  const { ok, error: flashError } = await searchParams;

  const supabase = await createClient();
  // The list and this page read the SAME function (p_org narrows it to one row), so there is only
  // ever one definition of what an office looks like.
  const [{ data: orgsData }, { data: paymentsData }, { data: historyData }] = await Promise.all([
    supabase.rpc("platform_list_orgs", { p_org: orgId }),
    supabase.rpc("operator_list_payments", { p_org: orgId }),
    supabase.rpc("platform_subscription_history", { p_org: orgId }),
  ]);
  const org = ((orgsData ?? []) as PlatformOrgRow[])[0];
  if (!org) notFound();
  const payments = (paymentsData ?? []) as PaymentRow[];
  const history = (historyData ?? []) as SubscriptionEventRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{org.org_name}</h1>
          {org.status && (
            <Badge tone={SUBSCRIPTION_STATUS_TONE[org.status] ?? "neutral"}>
              {SUBSCRIPTION_STATUS_AR[org.status] ?? org.status}
            </Badge>
          )}
        </div>
        <Link href="/platform/tenants" className="text-sm text-brand hover:underline">→ كل المكاتب</Link>
      </div>

      {ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">حُدِّث الاشتراك.</p>
      )}
      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>
      )}

      {/* Usage against the plan ceiling — counts of what this office manages, never its rows. */}
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
        <UsageMeter label="عقارات" used={org.properties} limit={org.max_properties} />
        <UsageMeter label="وحدات" used={org.units} limit={org.max_units} />
        <UsageMeter label="أعضاء" used={org.members} limit={org.max_members} />
      </div>

      <form action={setSubscription} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <input type="hidden" name="org_id" value={orgId} />
        <h2 className="font-semibold">إدارة الاشتراك</h2>
        <p className="text-xs text-slate-500">اترك الحقل فارغاً لإبقاء قيمته الحالية. كل تغيير يُسجَّل في التدقيق ومسار الاشتراك.</p>
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <label className="block text-sm">
          ملاحظة (سبب المنح/التمديد)
          <input name="notes" className={fieldCls} />
        </label>
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg">
          حفظ التغييرات
        </button>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 font-semibold">سجل المدفوعات</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">لا مدفوعات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-slate-500">
                <tr className="[&>th]:py-1 [&>th]:font-medium">
                  <th>التاريخ</th>
                  <th>الخطة</th>
                  <th>المبلغ</th>
                  <th>الحالة</th>
                  <th>مرجع البوابة</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-slate-200 [&>td]:py-1.5 dark:border-slate-800">
                    <td dir="ltr" className="text-left">{fmtDate(p.paid_at ?? p.created_at)}</td>
                    <td>{p.plan_code}</td>
                    <td dir="ltr" className="text-left">{halalasToSar(p.amount_halalas)} ر.س</td>
                    <td>{p.status}</td>
                    <td dir="ltr" className="text-left text-xs text-slate-500">{p.gateway_payment_id ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Every plan/status change lands here whatever made it — the console, the billing engine, or
          a webhook — because a trigger records it (0048). */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 font-semibold">مسار الاشتراك</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">لا تغييرات مسجّلة.</p>
        ) : (
          <ol className="space-y-3">
            {history.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{SUBSCRIPTION_EVENT_AR[e.kind] ?? e.kind}</span>
                    <span className="text-xs text-slate-400" dir="ltr">{fmtDate(e.created_at)}</span>
                    {e.detail?.reconstructed && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                        مُستنتَج قبل بدء التسجيل
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {e.from_plan && e.from_plan !== e.to_plan && <span dir="ltr">{e.from_plan} → {e.to_plan}</span>}
                    {e.from_status && e.from_status !== e.to_status && (
                      <span className="ms-2">
                        {SUBSCRIPTION_STATUS_AR[e.from_status] ?? e.from_status} ←{" "}
                        {SUBSCRIPTION_STATUS_AR[e.to_status ?? ""] ?? e.to_status}
                      </span>
                    )}
                    {!e.from_plan && !e.from_status && <span dir="ltr">{e.to_plan}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
