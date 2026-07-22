import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";

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

export async function Dashboard() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const soon = isoInDays(60);

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
  const collected = fin ? Number(fin.collected_month_halalas) : 0;
  const prev = fin ? Number(fin.collected_prev_halalas) : 0;
  const trend = collected - prev;

  const empty = nProps === 0 && nUnits === 0 && nActive === 0;

  if (empty) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-lg font-semibold">ابدأ إدارة عقاراتك</h2>
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
          أضِف عقاراتك ووحداتها لتبدأ ببناء سجلّك، وستظهر هنا مؤشرات مكتبك (الإشغال، التحصيل، المتأخرات).
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/properties"
            className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg"
          >
            الانتقال إلى العقارات ←
          </Link>
          <Link
            href="/app/import"
            className="inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            استيراد من Excel
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">لوحة المؤشرات</h2>
        <span className="text-xs text-neutral-400">تُحدَّث لحظياً</span>
      </div>

      {/* Primary money + occupancy cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Occupancy */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs text-neutral-500">نسبة الإشغال</p>
          <p className="mt-1 text-2xl font-bold">{occupancy}%</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${occupancy}%` }} />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {nRented} مؤجرة{nVacant > 0 ? ` · ${nVacant} شاغرة` : ""} من {nUnits} وحدة
          </p>
        </div>

        {/* Collected this month */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs text-neutral-500">تحصيل {monthName} (ر.س)</p>
          {financeMissing ? (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">طبّق هجرة 0021</p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-400">{halalasToSar(collected)}</p>
              <p className="mt-2 text-xs text-neutral-500">
                {trend === 0
                  ? "كالشهر الماضي"
                  : trend > 0
                    ? `▲ ${halalasToSar(trend)} عن الشهر الماضي`
                    : `▼ ${halalasToSar(-trend)} عن الشهر الماضي`}
              </p>
            </>
          )}
        </div>

        {/* Overdue / arrears */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs text-neutral-500">المتأخرات (ر.س)</p>
          {financeMissing ? (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">طبّق هجرة 0021</p>
          ) : (
            <>
              <p className={`mt-1 text-2xl font-bold ${Number(fin?.overdue_halalas) > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                {halalasToSar(fin?.overdue_halalas ?? 0)}
              </p>
              <p className="mt-2 text-xs text-neutral-500">{Number(fin?.overdue_charges ?? 0)} استحقاق متأخر</p>
            </>
          )}
        </div>

        {/* Total outstanding receivable */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs text-neutral-500">إجمالي المستحق (ر.س)</p>
          {financeMissing ? (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">طبّق هجرة 0021</p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold">{halalasToSar(fin?.outstanding_halalas ?? 0)}</p>
              <p className="mt-2 text-xs text-neutral-500">غير المسدَّد على المستأجرين</p>
            </>
          )}
        </div>
      </div>

      {financeMissing && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          البطاقات المالية (التحصيل والمتأخرات) تحتاج تطبيق هجرة <code>0021_dashboard_kpis.sql</code> على القاعدة. باقي المؤشرات تعمل الآن.
        </p>
      )}

      {/* Activity strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/app/contracts" className="rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm hover:border-brand dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-2xl font-bold">{nActive}</p>
          <p className="mt-1 text-xs text-neutral-500">عقد نشط</p>
        </Link>
        <Link href="/app/contracts" className="rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm hover:border-brand dark:border-neutral-800 dark:bg-neutral-900">
          <p className={`text-2xl font-bold ${nEndingSoon > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>{nEndingSoon}</p>
          <p className="mt-1 text-xs text-neutral-500">ينتهي خلال 60 يوماً</p>
        </Link>
        <Link href="/app/properties" className="rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm hover:border-brand dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-2xl font-bold">{nProps}</p>
          <p className="mt-1 text-xs text-neutral-500">عقار</p>
        </Link>
        <Link href="/app/tenants" className="rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm hover:border-brand dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-2xl font-bold">{nTenants}</p>
          <p className="mt-1 text-xs text-neutral-500">مستأجر</p>
        </Link>
      </div>
    </section>
  );
}
