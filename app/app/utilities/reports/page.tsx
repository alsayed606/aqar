import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { Badge } from "@/components/ui";
import { UtilitiesTabs } from "@/components/utilities-tabs";
import { halalasToSar } from "@/lib/money";
import { UTILITY_TYPE_AR } from "@/lib/labels";
import { lastMonths } from "@/lib/utilities";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const REPORTS = [
  { key: "due", label: "الفواتير المستحقة" },
  { key: "overdue", label: "الفواتير المتأخرة" },
  { key: "consumption", label: "الاستهلاك الشهري" },
  { key: "attention", label: "عدادات تحتاج انتباهاً" },
];

// Every kind here is something a person has to go and do; the wording says what, not just what is
// wrong. See docs/foundation/09-utilities-module.md §7.
const ATTENTION: Record<string, { label: string; tone: "warning" | "danger" | "neutral"; what: string }> = {
  stale_reading: { label: "بلا قراءة منذ ٦٠ يوماً", tone: "warning", what: "سجّل قراءة للعدّاد" },
  bill_without_reading: { label: "فاتورة بلا قراءة تسندها", tone: "warning", what: "أدخل قراءة الشهر أو أضِفها للفاتورة" },
  rented_unit_without_meter: { label: "وحدة مؤجَّرة بلا عدّاد", tone: "neutral", what: "أضِف عدّاداً للوحدة إن كانت تُحاسَب" },
  reading_needs_review: { label: "قراءة تحتاج مراجعة", tone: "danger", what: "أكّد استبدال العدّاد أو صحّح الرقم" },
};

const box = "overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800";
const head = "bg-slate-50 text-slate-500 dark:bg-slate-900/60";
const headRow = "[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
      {children}
    </p>
  );
}

function BillsReport({ bills, emptyText }: { bills: any[]; emptyText: string }) {
  if (bills.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <div className={box}>
      <table className="w-full text-sm">
        <thead className={head}>
          <tr className={headRow}>
            <th>الشهر</th>
            <th>العدّاد</th>
            <th>العقار / الوحدة</th>
            <th>الإجمالي</th>
            <th>الاستحقاق</th>
            <th>يتحمّلها</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {bills.map((b) => (
            <tr key={b.id} className="[&>td]:px-3 [&>td]:py-2">
              <td dir="ltr" className="text-right whitespace-nowrap">{b.billing_month.slice(0, 7)}</td>
              <td dir="ltr" className="text-right">{b.meter_number}</td>
              <td>
                <Link href={`/app/properties/${b.property_id}`} className="hover:text-brand hover:underline">
                  {b.property_name}
                </Link>
                <span className="text-xs text-slate-500">
                  {" "}· {b.unit_number ? `وحدة ${b.unit_number}` : "رئيسي"} · {UTILITY_TYPE_AR[b.utility_type] ?? b.utility_type}
                </span>
              </td>
              <td dir="ltr" className="text-right font-medium whitespace-nowrap">{halalasToSar(b.total_halalas)} ر.س</td>
              <td dir="ltr" className="text-right whitespace-nowrap">{b.due_date ?? "—"}</td>
              <td>
                {b.bearer_name ?? "—"}
                <span className="text-xs text-slate-500"> ({b.bearer_kind === "tenant" ? "مستأجر" : "مالك"})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const sp = await searchParams;
  const active = REPORTS.some((r) => r.key === sp.r) ? (sp.r as string) : "due";

  const supabase = await createClient();
  const months = lastMonths(12);

  // Only the selected report is queried. Running all four on every visit would make three of them
  // pure waste on every page view.
  let bills: any[] = [];
  let consumption: any[] = [];
  let attention: any[] = [];

  if (active === "due" || active === "overdue") {
    let query = supabase
      .from("utility_bill_view")
      .select("id, billing_month, meter_number, utility_type, property_id, property_name, unit_number, total_halalas, due_date, bearer_kind, bearer_name")
      .eq("is_paid", false);
    // "Due" is what is still coming; "overdue" is what should already have been paid. A bill with
    // no due date at all belongs to neither — there is nothing to be early or late against.
    query = active === "overdue" ? query.eq("is_overdue", true) : query.eq("is_overdue", false).not("due_date", "is", null);
    const { data } = await query.order("due_date", { ascending: true }).limit(200);
    bills = data ?? [];
  } else if (active === "consumption") {
    const { data } = await supabase
      .from("utility_monthly_consumption")
      .select("meter_id, meter_number, utility_type, property_name, unit_number, month, consumption")
      .gte("month", months[0])
      .order("month", { ascending: true })
      .limit(2000);
    consumption = data ?? [];
  } else {
    const { data } = await supabase
      .from("utility_attention")
      .select("kind, meter_id, unit_id, meter_number, utility_type, property_id, property_name, unit_number, ref_date")
      .order("kind", { ascending: true })
      .limit(500);
    attention = data ?? [];
  }

  // Report 3 reads as a trend, so meters are rows and months are columns.
  const meterRows = new Map<string, { label: string; where: string; byMonth: Map<string, number | null> }>();
  for (const row of consumption) {
    const entry = meterRows.get(row.meter_id) ?? {
      label: `${UTILITY_TYPE_AR[row.utility_type] ?? row.utility_type} ${row.meter_number}`,
      where: `${row.property_name}${row.unit_number ? ` · وحدة ${row.unit_number}` : " · رئيسي"}`,
      byMonth: new Map(),
    };
    entry.byMonth.set(String(row.month).slice(0, 7), row.consumption == null ? null : Number(row.consumption));
    meterRows.set(row.meter_id, entry);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">تقارير المرافق</h1>

      <UtilitiesTabs />

      <div className="flex flex-wrap gap-2 text-sm">
        {REPORTS.map((r) => (
          <Link
            key={r.key}
            href={`/app/utilities/reports?r=${r.key}`}
            className={
              "rounded-lg border px-3 py-1.5 " +
              (active === r.key
                ? "border-brand bg-brand/10 font-medium text-brand"
                : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800")
            }
          >
            {r.label}
          </Link>
        ))}
      </div>

      {active === "due" && (
        <BillsReport bills={bills} emptyText="لا توجد فواتير مستحقة لم يحن موعدها." />
      )}

      {active === "overdue" && (
        <BillsReport bills={bills} emptyText="لا توجد فواتير متأخّرة." />
      )}

      {active === "consumption" && (
        meterRows.size === 0 ? (
          <Empty>لا توجد قراءات في آخر ١٢ شهراً.</Empty>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              الشهر الفارغ لا قراءة له، و«—» يعني قراءة بلا استهلاك معروف (أساس أو تحتاج مراجعة) — ولا
              يُعرض صفراً، لأن الصفر يعني «لم يُستهلك شيء».
            </p>
            <div className={box}>
              <table className="w-full text-sm">
                <thead className={head}>
                  <tr className={headRow}>
                    <th>العدّاد</th>
                    {months.map((m) => (
                      <th key={m} dir="ltr" className="whitespace-nowrap">{m.slice(0, 7)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[...meterRows.entries()].map(([id, row]) => (
                    <tr key={id} className="[&>td]:px-3 [&>td]:py-2">
                      <td>
                        <span className="font-medium">{row.label}</span>
                        <p className="text-xs text-slate-500">{row.where}</p>
                      </td>
                      {months.map((m) => {
                        const key = m.slice(0, 7);
                        const has = row.byMonth.has(key);
                        const value = row.byMonth.get(key);
                        return (
                          <td key={m} dir="ltr" className="text-right">
                            {!has ? "" : value == null ? <span className="text-slate-400">—</span> : value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {active === "attention" && (
        attention.length === 0 ? (
          <Empty>لا شيء يحتاج انتباهاً الآن.</Empty>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              {attention.length} بنداً. هذا التقرير يقود إلى فعل: كل سطر فيه شيء ناقص أو معلَّق، لا وضع سليم.
            </p>
            <div className={box}>
              <table className="w-full text-sm">
                <thead className={head}>
                  <tr className={headRow}>
                    <th>الحالة</th>
                    <th>العدّاد / الوحدة</th>
                    <th>العقار</th>
                    <th>التاريخ</th>
                    <th>المطلوب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {attention.map((a, i) => {
                    const kind = ATTENTION[a.kind];
                    return (
                      <tr key={`${a.kind}-${a.meter_id ?? a.unit_id}-${i}`} className="[&>td]:px-3 [&>td]:py-2">
                        <td><Badge tone={kind?.tone ?? "neutral"}>{kind?.label ?? a.kind}</Badge></td>
                        <td>
                          {a.meter_number ? (
                            <>
                              <span dir="ltr" className="font-medium">{a.meter_number}</span>
                              <span className="text-xs text-slate-500"> {UTILITY_TYPE_AR[a.utility_type] ?? ""}</span>
                            </>
                          ) : (
                            <span className="font-medium">وحدة {a.unit_number}</span>
                          )}
                        </td>
                        <td>
                          <Link href={`/app/properties/${a.property_id}`} className="hover:text-brand hover:underline">
                            {a.property_name}
                          </Link>
                          {a.meter_number && a.unit_number && (
                            <span className="text-xs text-slate-500"> · وحدة {a.unit_number}</span>
                          )}
                        </td>
                        <td dir="ltr" className="text-right whitespace-nowrap text-slate-500">{a.ref_date ?? "—"}</td>
                        <td className="text-slate-600 dark:text-slate-300">
                          {kind?.what}
                          {a.meter_id && (
                            <Link
                              href={
                                a.kind === "bill_without_reading"
                                  ? `/app/utilities/bills?meter=${a.meter_id}`
                                  : `/app/utilities/readings?meter=${a.meter_id}${a.kind === "reading_needs_review" ? "&review=1" : ""}`
                              }
                              className="mr-2 text-xs text-brand hover:underline"
                            >
                              افتح ←
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </div>
  );
}
