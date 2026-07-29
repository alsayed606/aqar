import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { Card, CardBody, Badge, buttonClasses } from "@/components/ui";

/**
 * Office KPI dashboard for the active org. All reads go through RLS + the x-active-org header, so
 * every number is scoped to the active org automatically.
 *
 * Counts use cheap head-count queries (no DB function needed → they render even before migration
 * 0021). Money sums come from app.dashboard_finance() (0021); if that migration isn't applied yet
 * the finance cards degrade to a clear "apply 0021" hint instead of erroring.
 */

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Finance = {
  outstanding_halalas: number;
  overdue_halalas: number;
  overdue_charges: number;
  collected_month_halalas: number;
  collected_prev_halalas: number;
};

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="p-4">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{children}</div>
        {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
      </CardBody>
    </Card>
  );
}

export async function Dashboard() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const soon = isoInDays(60);

  // Refresh operational notifications on home load (idempotent; a no-op error before migration 0034).
  const activeOrg = await getActiveOrg();
  if (activeOrg) {
    await supabase.rpc("generate_notifications", { p_org: activeOrg });
    // Queue email deliveries (idempotent; no-op before 0038). The Vercel Cron drainer sends them.
    await supabase.rpc("enqueue_email_deliveries", { p_org: activeOrg });
  }

  // Run every count in parallel. head:true → no rows transferred, just the count.
  const [
    properties,
    unitsTotal,
    unitsRented,
    unitsVacant,
    tenants,
    activeContracts,
    endingSoon,
    financeRes,
  ] = await Promise.all([
    supabase.from("property").select("*", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("unit").select("*", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("unit").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("current_status", "rented"),
    supabase.from("unit").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("current_status", "vacant"),
    supabase.from("tenant").select("*", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("contract").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("status", "active"),
    supabase.from("contract").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("status", "active").gte("end_date", today).lte("end_date", soon),
    supabase.rpc("dashboard_finance"),
  ]);

  const nProps = properties.count ?? 0;
  const nUnits = unitsTotal.count ?? 0;
  const nRented = unitsRented.count ?? 0;
  const nVacant = unitsVacant.count ?? 0;
  const nTenants = tenants.count ?? 0;
  const nActive = activeContracts.count ?? 0;
  const nEndingSoon = endingSoon.count ?? 0;

  const occupancy = nUnits > 0 ? Math.round((nRented / nUnits) * 100) : 0;

  const fin = (Array.isArray(financeRes.data) ? financeRes.data[0] : financeRes.data) as Finance | null;
  const financeMissing = !!financeRes.error;

  const now = new Date();
  const monthName = MONTHS_AR[now.getMonth()];
  const prevName = MONTHS_AR[(now.getMonth() + 11) % 12];
  const collected = fin ? Number(fin.collected_month_halalas) : 0;
  const prev = fin ? Number(fin.collected_prev_halalas) : 0;
  const trend = collected - prev;
  const maxBar = Math.max(collected, prev, 1);

  const empty = nProps === 0 && nUnits === 0 && nActive === 0;

  if (empty) {
    return (
      <Card>
        <CardBody>
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">ابدأ إدارة عقاراتك</h2>
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
            أضِف عقاراتك ووحداتها لتبدأ ببناء سجلّك، وستظهر هنا مؤشرات مكتبك (الإشغال، التحصيل، المتأخرات).
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/properties" className={buttonClasses()}>الانتقال إلى العقارات ←</Link>
            <Link href="/app/import" className={buttonClasses({ variant: "outline" })}>استيراد من Excel</Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">لوحة المؤشرات</h2>
        <Badge tone="success">تُحدَّث لحظياً</Badge>
      </div>

      {/* Primary money + occupancy cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="نسبة الإشغال"
          hint={<>{nRented} مؤجرة{nVacant > 0 ? ` · ${nVacant} شاغرة` : ""} من {nUnits} وحدة</>}
        >
          {occupancy}%
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${occupancy}%` }} />
          </div>
        </Stat>

        <Stat
          label={`تحصيل ${monthName} (ر.س)`}
          hint={
            financeMissing ? undefined : trend === 0 ? "كالشهر الماضي" : trend > 0 ? `▲ ${halalasToSar(trend)} عن الشهر الماضي` : `▼ ${halalasToSar(-trend)} عن الشهر الماضي`
          }
        >
          {financeMissing ? <span className="text-sm text-amber-600 dark:text-amber-300">طبّق هجرة 0021</span> : <span className="text-emerald-700 dark:text-emerald-400">{halalasToSar(collected)}</span>}
        </Stat>

        <Stat label="المتأخرات (ر.س)" hint={financeMissing ? undefined : `${Number(fin?.overdue_charges ?? 0)} استحقاق متأخر`}>
          {financeMissing ? (
            <span className="text-sm text-amber-600 dark:text-amber-300">طبّق هجرة 0021</span>
          ) : (
            <span className={Number(fin?.overdue_halalas) > 0 ? "text-red-600 dark:text-red-400" : ""}>{halalasToSar(fin?.overdue_halalas ?? 0)}</span>
          )}
        </Stat>

        <Stat label="إجمالي المستحق (ر.س)" hint={financeMissing ? undefined : "غير المسدَّد على المستأجرين"}>
          {financeMissing ? <span className="text-sm text-amber-600 dark:text-amber-300">طبّق هجرة 0021</span> : halalasToSar(fin?.outstanding_halalas ?? 0)}
        </Stat>
      </div>

      {/* This month vs last month collection comparison */}
      {!financeMissing && (collected > 0 || prev > 0) && (
        <Card>
          <CardBody className="p-4">
            <p className="mb-3 text-xs font-medium text-slate-500">مقارنة التحصيل الشهري</p>
            <div className="space-y-2">
              {[
                { name: monthName, val: collected, tone: "bg-brand" },
                { name: prevName, val: prev, tone: "bg-slate-300 dark:bg-slate-600" },
              ].map((b) => (
                <div key={b.name} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs text-slate-500">{b.name}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-full rounded-full ${b.tone} transition-all`} style={{ width: `${Math.round((b.val / maxBar) * 100)}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-left text-xs text-slate-600 dark:text-slate-300" dir="ltr">{halalasToSar(b.val)}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {financeMissing && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          البطاقات المالية (التحصيل والمتأخرات) تحتاج تطبيق هجرة <code>0021_dashboard_kpis.sql</code> على القاعدة. باقي المؤشرات تعمل الآن.
        </p>
      )}

      {/* Activity strip — collapsible */}
      <details open className="group rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
          نشاط المحفظة
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-400 transition-transform group-open:rotate-180">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4 sm:grid-cols-4 dark:border-slate-800">
          <ActivityTile href="/app/contracts" value={nActive} label="عقد نشط" />
          <ActivityTile href="/app/contracts" value={nEndingSoon} label="ينتهي خلال 60 يوماً" warn={nEndingSoon > 0} />
          <ActivityTile href="/app/properties" value={nProps} label="عقار" />
          <ActivityTile href="/app/tenants" value={nTenants} label="مستأجر" />
        </div>
      </details>
    </section>
  );
}

function ActivityTile({ href, value, label, warn }: { href: string; value: number; label: string; warn?: boolean }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:border-brand dark:border-slate-800 dark:bg-slate-900">
      <p className={`text-2xl font-bold ${warn ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-white"}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </Link>
  );
}
