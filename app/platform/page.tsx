import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { fmtDate } from "@/lib/subscription";
import { StatCard } from "@/components/platform/stat-card";
import { BarChart } from "@/components/platform/bar-chart";
import { ALERT_META, type AlertRow } from "@/lib/platform";

export const dynamic = "force-dynamic";

type Kpis = {
  mrr_halalas: number; mrr_at_risk_halalas: number; arr_halalas: number;
  orgs_total: number; orgs_active: number; orgs_trialing: number; orgs_comped: number;
  orgs_past_due: number; orgs_canceled: number;
  trials_expiring_7d: number; subs_expiring_30d: number;
  canceled_30d: number; activated_30d: number; churn_rate_30d: number | null;
  new_orgs_month: number; new_orgs_prev_month: number; growth_rate_month: number | null;
  revenue_month_halalas: number; revenue_prev_halalas: number; failed_payments_30d: number;
  properties: number; units: number; contracts: number; users: number; active_today: number;
  trend_since: string | null;
};
type SeriesRow = { month_start: string; paid_halalas: number; payments: number; new_orgs: number };
type PlanRow = { plan_code: string; plan_name_ar: string; price_halalas: number; orgs: number; orgs_active: number; mrr_halalas: number };
type TopRow = { org_id: string; org_name: string; plan_code: string | null; paid_halalas: number; payments: number };

const pct = (v: number | null) => (v == null ? null : `${(v * 100).toFixed(1)}%`);
const monthLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default async function PlatformDashboard() {
  const supabase = await createClient();
  const [{ data: kpiData, error }, { data: seriesData }, { data: planData }, { data: topData }, { data: alertData }] =
    await Promise.all([
      supabase.rpc("platform_kpis"),
      supabase.rpc("platform_revenue_series", { p_months: 12 }),
      supabase.rpc("platform_plan_distribution"),
      supabase.rpc("platform_top_customers", { p_limit: 5 }),
      supabase.rpc("platform_alerts"),
    ]);

  if (error) {
    const pending = error.message?.includes("platform_kpis");
    return (
      <p className={"rounded-2xl border border-dashed p-8 text-center text-sm " + (pending ? "border-amber-400 text-amber-700 dark:text-amber-300" : "border-red-300 text-red-700")}>
        {pending ? <>طبّق الهجرة <span dir="ltr">0049</span> لتفعيل اللوحة التنفيذية.</> : error.message}
      </p>
    );
  }

  const k = kpiData as Kpis;
  const series = (seriesData ?? []) as SeriesRow[];
  const plans = (planData ?? []) as PlanRow[];
  const top = (topData ?? []) as TopRow[];

  // Alerts ride at the top of the dashboard rather than waiting on their own page: an executive
  // opens this screen, and a failed cron or a stalled webhook should not need a second click.
  const alerts = (alertData ?? []) as AlertRow[];
  const urgent = alerts.filter((a) => a.severity === 1);
  const revenueDelta = k.revenue_month_halalas - k.revenue_prev_halalas;
  const totals = [
    { label: "عقارات", value: k.properties },
    { label: "وحدات", value: k.units },
    { label: "عقود", value: k.contracts },
    { label: "مستخدمون", value: k.users },
    { label: "نشط اليوم", value: k.active_today },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">اللوحة التنفيذية</h1>
        <p className="text-xs text-slate-500">
          {k.trend_since
            ? <>تسجيل تغيّرات الاشتراكات بدأ <span dir="ltr">{fmtDate(k.trend_since)}</span> — ما قبله غير مُسجَّل.</>
            : "لم تُسجَّل تغيّرات اشتراك بعد؛ مؤشرات الاتجاه تبدأ من أول تغيير."}
        </p>
      </div>

      {alerts.length > 0 && (
        <Link
          href="/platform/alerts"
          className={
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-3 text-sm transition-colors " +
            (urgent.length > 0
              ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
              : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200")
          }
        >
          <span className="font-medium">
            {urgent.length > 0 ? `${urgent.length} تنبيه يستدعي تصرّفاً الآن` : `${alerts.length} تنبيه للمراجعة`}
          </span>
          <span className="text-xs opacity-80">
            {alerts.slice(0, 3).map((a) => ALERT_META[a.kind]?.title ?? a.kind).join(" · ")}
          </span>
          <span className="ms-auto text-xs underline">عرض الكل ←</span>
        </Link>
      )}

      {/* Recurring revenue. MRR counts active subscriptions only — a trial pays nothing and a comp
          is a grant, so both are shown as counts elsewhere, never folded into revenue. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="الإيراد الشهري المتكرر (MRR)" value={`${halalasToSar(k.mrr_halalas)} ر.س`} hint={`${k.orgs_active} اشتراك نشط`} />
        <StatCard label="الإيراد السنوي المتوقّع (ARR)" value={`${halalasToSar(k.arr_halalas)} ر.س`} hint="MRR × 12" />
        <StatCard
          label="إيراد معرّض للخطر"
          value={`${halalasToSar(k.mrr_at_risk_halalas)} ر.س`}
          hint={`${k.orgs_past_due} اشتراك متأخر`}
          tone={k.orgs_past_due > 0 ? "warn" : "default"}
        />
        <StatCard
          label="محصّل هذا الشهر"
          value={`${halalasToSar(k.revenue_month_halalas)} ر.س`}
          hint={<>الشهر الماضي {halalasToSar(k.revenue_prev_halalas)} · {revenueDelta >= 0 ? "▲" : "▼"} {halalasToSar(Math.abs(revenueDelta))}</>}
          tone={revenueDelta >= 0 ? "good" : "warn"}
        />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="مكاتب مشتركة" value={k.orgs_total} hint={`${k.orgs_comped} ممنوح · ${k.orgs_canceled} ملغى`} />
        <StatCard label="حسابات تجريبية" value={k.orgs_trialing} hint={`${k.trials_expiring_7d} تنتهي خلال ٧ أيام`} tone={k.trials_expiring_7d > 0 ? "warn" : "default"} />
        <StatCard label="اشتراكات تُجدَّد خلال ٣٠ يوماً" value={k.subs_expiring_30d} />
        <StatCard label="مدفوعات فاشلة (٣٠ يوماً)" value={k.failed_payments_30d} tone={k.failed_payments_30d > 0 ? "bad" : "default"} />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="معدّل الفقد (٣٠ يوماً)"
          value={pct(k.churn_rate_30d) ?? "—"}
          hint={`${k.canceled_30d} مغادر · ${k.activated_30d} مُفعَّل`}
          tone={k.churn_rate_30d != null && k.churn_rate_30d > 0.05 ? "bad" : "default"}
          unavailable={k.churn_rate_30d == null}
        />
        <StatCard
          label="نمو المكاتب (شهرياً)"
          value={pct(k.growth_rate_month) ?? "—"}
          hint={`${k.new_orgs_month} هذا الشهر · ${k.new_orgs_prev_month} الماضي`}
          tone={k.growth_rate_month != null && k.growth_rate_month >= 0 ? "good" : "warn"}
          unavailable={k.growth_rate_month == null}
        />
        <StatCard label="مكاتب جديدة هذا الشهر" value={k.new_orgs_month} />
        <StatCard label="نشط اليوم" value={k.active_today} hint={`من ${k.users} مستخدماً`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">الإيراد المحصّل — ١٢ شهراً</h2>
          <BarChart
            data={series.map((r) => ({
              label: monthLabel(r.month_start),
              value: Number(r.paid_halalas),
              title: `${monthLabel(r.month_start)}: ${halalasToSar(r.paid_halalas)} ر.س (${r.payments} عملية)`,
            }))}
            emptyText="لا مدفوعات محصّلة بعد."
          />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">مكاتب جديدة — ١٢ شهراً</h2>
          <BarChart
            data={series.map((r) => ({
              label: monthLabel(r.month_start),
              value: Number(r.new_orgs),
              title: `${monthLabel(r.month_start)}: ${r.new_orgs} مكتب`,
            }))}
            emptyText="لا تسجيلات في هذه الفترة."
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">توزيع الخطط</h2>
          <ul className="space-y-3">
            {plans.map((p) => {
              const share = k.orgs_total > 0 ? p.orgs / k.orgs_total : 0;
              return (
                <li key={p.plan_code}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{p.plan_name_ar}</span>
                    <span className="text-xs text-slate-500" dir="ltr">
                      {p.orgs} · {halalasToSar(p.mrr_halalas)} ر.س
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(share * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">{p.orgs_active} نشط من {p.orgs}</p>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">أعلى العملاء تحصيلاً</h2>
          {top.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">لا مدفوعات محصّلة بعد.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {top.map((t) => (
                <li key={t.org_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/platform/tenants/${t.org_id}`} className="truncate font-medium hover:text-brand hover:underline">
                    {t.org_name}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500" dir="ltr">
                    {halalasToSar(t.paid_halalas)} ر.س · {t.payments}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Platform-wide totals. Counts of what the offices manage — never their rows (ADR-0006). */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">حجم المنصة</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {totals.map((t) => (
            <div key={t.label}>
              <dt className="text-xs text-slate-500">{t.label}</dt>
              <dd className="text-xl font-bold tabular-nums text-slate-900 dark:text-white" dir="ltr">{t.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
