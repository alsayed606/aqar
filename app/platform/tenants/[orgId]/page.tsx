import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { fmtDate } from "@/lib/subscription";
import { ROLE_AR, MEMBER_STATUS_AR, SUBSCRIPTION_STATUS_AR, SUBSCRIPTION_STATUS_TONE, SUBSCRIPTION_EVENT_AR } from "@/lib/labels";
import { Badge } from "@/components/ui";
import { UsageMeter } from "@/components/usage-meter";
import { StatCard } from "@/components/platform/stat-card";
import { TenantActions } from "@/components/platform/tenant-actions";
import type { PlanOption, SubscriptionEventRow, Tenant360 } from "@/lib/platform";
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

const STATUSES = ["trialing", "active", "comped", "past_due", "suspended", "canceled"];
const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700";
const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";

export default async function Tenant360Page({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { orgId } = await params;
  const { ok, error: flashError } = await searchParams;

  const supabase = await createClient();
  const [{ data: t360Data, error }, { data: paymentsData }, { data: historyData }, { data: planData }] =
    await Promise.all([
      supabase.rpc("platform_tenant_360", { p_org: orgId }),
      supabase.rpc("operator_list_payments", { p_org: orgId }),
      supabase.rpc("platform_subscription_history", { p_org: orgId }),
      // Read the catalog rather than listing plans here: it is editable from the console.
      supabase.from("plan").select("code, name_ar").order("sort"),
    ]);

  if (error?.message?.includes("platform_tenant_360")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0050</span> لتفعيل صفحة المكتب الكاملة.
      </p>
    );
  }
  const t = t360Data as Tenant360 | null;
  if (!t) notFound();

  const payments = (paymentsData ?? []) as PaymentRow[];
  const history = (historyData ?? []) as SubscriptionEventRow[];
  const plans = (planData ?? []) as PlanOption[];
  const sub = t.subscription;
  const occupancy = t.portfolio.units > 0 ? Math.round((t.portfolio.units_rented / t.portfolio.units) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.org.name}</h1>
          {sub?.status && (
            <Badge tone={SUBSCRIPTION_STATUS_TONE[sub.status] ?? "neutral"}>
              {SUBSCRIPTION_STATUS_AR[sub.status] ?? sub.status}
            </Badge>
          )}
          {sub && !sub.active && <span className="text-xs text-red-600 dark:text-red-400">الإنشاء الجديد موقوف</span>}
        </div>
        <div className="flex items-center gap-2">
          <TenantActions
            orgId={orgId}
            status={sub?.status ?? null}
            planCode={sub?.plan_code ?? null}
            plans={plans}
            back={`/platform/tenants/${orgId}`}
          />
          <Link href="/platform/tenants" className="text-sm text-brand hover:underline">→ كل المكاتب</Link>
        </div>
      </div>

      {ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">تم التنفيذ.</p>
      )}
      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="الخطة" value={sub?.plan_name ?? sub?.plan_code ?? "—"} hint={sub ? `${halalasToSar(sub.price_halalas)} ر.س شهرياً` : undefined} />
        <StatCard label="دفع لنا" value={`${halalasToSar(t.revenue.paid_halalas)} ر.س`} hint={`${t.revenue.payments} عملية · آخرها ${fmtDate(t.revenue.last_paid_at)}`} />
        <StatCard label="آخر دخول" value={fmtDate(t.activity.last_sign_in_at)} hint={`${t.activity.active_today} نشط اليوم`} />
        <StatCard
          label="مدفوعات فاشلة (٣٠ يوماً)"
          value={t.revenue.failed_30d}
          tone={t.revenue.failed_30d > 0 ? "bad" : "default"}
        />
      </section>

      <section className={cardCls}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">الاستهلاك مقابل سقف الخطة</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <UsageMeter label="عقارات" used={t.usage.properties} limit={t.limits.properties} />
          <UsageMeter label="وحدات" used={t.usage.units} limit={t.limits.units} />
          <UsageMeter label="أعضاء" used={t.usage.members} limit={t.limits.members} />
        </div>
      </section>

      {/* Counts of what this office manages — never a row of it (ADR-0006). The office's own
          collections and arrears are its business and are deliberately absent. */}
      <section className={cardCls}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">المحفظة</h2>
          <p className="text-[11px] text-slate-400">أعداد فقط — بيانات المكتب المالية وبيانات عملائه لا تُعرض هنا</p>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "عقارات", value: t.portfolio.properties },
            { label: "وحدات", value: `${t.portfolio.units} (${occupancy}% مؤجّرة)` },
            { label: "عقود", value: `${t.portfolio.contracts_active} نشط من ${t.portfolio.contracts}` },
            { label: "ملّاك", value: t.portfolio.owners },
            { label: "مستأجرون", value: t.portfolio.tenants },
            { label: "وحدات شاغرة", value: t.portfolio.units_vacant },
            { label: "دفعات استيراد", value: t.import_batches },
            { label: "أنشئ في", value: fmtDate(t.org.created_at) },
          ].map((row) => (
            <div key={row.label}>
              <dt className="text-xs text-slate-500">{row.label}</dt>
              <dd className="text-lg font-bold text-slate-900 dark:text-white" dir="ltr">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={cardCls}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">فريق المكتب</h2>
        {t.team.length === 0 ? (
          <p className="text-sm text-slate-500">لا أعضاء.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-slate-500">
                <tr className="[&>th]:py-1 [&>th]:font-medium">
                  <th>العضو</th><th>الدور</th><th>الحالة</th><th>النطاق</th><th>آخر دخول</th>
                </tr>
              </thead>
              <tbody>
                {t.team.map((m) => (
                  <tr key={m.identity_id} className="border-t border-slate-200 [&>td]:py-1.5 dark:border-slate-800">
                    <td>
                      <span className="font-medium">{m.full_name ?? "—"}</span>
                      <span className="block text-[11px] text-slate-400" dir="ltr">{m.email ?? m.phone_e164 ?? ""}</span>
                    </td>
                    <td>{ROLE_AR[m.role] ?? m.role}</td>
                    <td>{MEMBER_STATUS_AR[m.status] ?? m.status}</td>
                    <td className="text-xs text-slate-500">{m.scope_all ? "كل العقارات" : "عقارات محدّدة"}</td>
                    <td dir="ltr" className="text-left text-xs">{fmtDate(m.last_sign_in_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form action={setSubscription} className={cardCls + " space-y-4"}>
        <input type="hidden" name="org_id" value={orgId} />
        <h2 className="font-semibold">إدارة الاشتراك</h2>
        <p className="text-xs text-slate-500">
          اترك الحقل فارغاً لإبقاء قيمته الحالية. كل تغيير يُسجَّل في التدقيق ومسار الاشتراك.
          {t.payment_method && (
            <> · البطاقة المحفوظة: <span dir="ltr">{t.payment_method.brand} ••••{t.payment_method.last4}</span>
              {sub?.auto_renew ? " · التجديد التلقائي مفعّل" : " · التجديد التلقائي متوقف"}</>
          )}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            الخطة <span className="text-slate-400">(الحالية: {sub?.plan_code ?? "—"})</span>
            <select name="plan" defaultValue="" className={fieldCls}>
              <option value="">— بدون تغيير —</option>
              {plans.map((p) => <option key={p.code} value={p.code}>{p.name_ar}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            الحالة <span className="text-slate-400">(الحالية: {sub?.status ? SUBSCRIPTION_STATUS_AR[sub.status] ?? sub.status : "—"})</span>
            <select name="status" defaultValue="" className={fieldCls}>
              <option value="">— بدون تغيير —</option>
              {STATUSES.map((s) => <option key={s} value={s}>{SUBSCRIPTION_STATUS_AR[s] ?? s}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            نهاية التجربة <span className="text-slate-400" dir="ltr">({fmtDate(sub?.trial_ends_at ?? null)})</span>
            <input type="date" name="trial_ends_at" dir="ltr" className={fieldCls} />
          </label>
          <label className="block text-sm">
            نهاية الفترة <span className="text-slate-400" dir="ltr">({fmtDate(sub?.current_period_end ?? null)})</span>
            <input type="date" name="period_end" dir="ltr" className={fieldCls} />
          </label>
        </div>
        <label className="block text-sm">
          ملاحظة (سبب المنح/التمديد)
          <input name="notes" defaultValue="" placeholder={sub?.notes ?? ""} className={fieldCls} />
        </label>
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg">
          حفظ التغييرات
        </button>
      </form>

      <section className={cardCls}>
        <h2 className="mb-3 font-semibold">سجل المدفوعات</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">لا مدفوعات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-slate-500">
                <tr className="[&>th]:py-1 [&>th]:font-medium">
                  <th>التاريخ</th><th>الخطة</th><th>المبلغ</th><th>الحالة</th><th>مرجع البوابة</th>
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
      </section>

      <section className={cardCls}>
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
      </section>
    </div>
  );
}
