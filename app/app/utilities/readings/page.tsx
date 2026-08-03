import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { ReadingForm, type ReadingMeter } from "@/components/reading-form";
import { ConfirmButton } from "@/components/confirm-button";
import { FormDrawer } from "@/components/form-drawer";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui";
import { UtilitiesTabs } from "@/components/utilities-tabs";
import { meterLabel } from "@/lib/utilities";
import { PAGE_SIZE } from "@/lib/list-params";
import { deleteReading, markReadingReset, updateReadingValue } from "../actions";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type ConsumptionRow = {
  id: string;
  meter_id: string;
  reading_date: string;
  value: number;
  is_reset: boolean;
  note: string | null;
  previous_value: number | null;
  consumption: number | null;
  needs_review: boolean;
};

export default async function ReadingsPage({
  searchParams,
}: {
  searchParams: Promise<{ meter?: string; page?: string; review?: string; error?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const sp = await searchParams;
  const meterFilter = (sp.meter ?? "").trim();
  const reviewOnly = sp.review === "1";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const caps = await getCapabilities(activeOrg);
  const canData = caps.has("manage_data");

  const supabase = await createClient();
  const { data: meterData } = await supabase
    .from("utility_meter")
    .select("id, utility_type, meter_number, status, property:property_id(name), unit:unit_id(unit_number)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const meters = (meterData ?? []).map((m: any) => ({
    id: m.id,
    status: m.status,
    label: meterLabel({
      utility_type: m.utility_type,
      meter_number: m.meter_number,
      unit_number: first(m.unit)?.unit_number ?? null,
      property_name: first(m.property)?.name ?? null,
    }),
  }));
  const meterById = new Map(meters.map((m) => [m.id, m]));

  // The consumption view applies the rule from the design note: a baseline reading and an
  // unexplained drop both yield NULL rather than an invented number.
  let readingsQuery = supabase
    .from("utility_consumption")
    .select("id, meter_id, reading_date, value, is_reset, note, previous_value, consumption, needs_review", {
      count: "exact",
    });
  if (meterFilter) readingsQuery = readingsQuery.eq("meter_id", meterFilter);
  if (reviewOnly) readingsQuery = readingsQuery.eq("needs_review", true);

  const { data, error, count } = await readingsQuery
    .order("reading_date", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const readings = (data ?? []) as ConsumptionRow[];
  const total = count ?? 0;

  // The add-reading form needs each meter's latest value so it can question a lower one before it
  // is saved. Only active meters are offered — an archived or removed meter is not being read.
  const activeMeters = meters.filter((m) => m.status === "active");
  const lastByMeter = new Map<string, number>();
  if (activeMeters.length) {
    const { data: latest } = await supabase
      .from("utility_reading")
      .select("meter_id, value, reading_date")
      .in("meter_id", activeMeters.map((m) => m.id))
      .is("deleted_at", null)
      .order("reading_date", { ascending: false });
    for (const r of latest ?? []) if (!lastByMeter.has(r.meter_id)) lastByMeter.set(r.meter_id, r.value);
  }
  const formMeters: ReadingMeter[] = activeMeters.map((m) => ({
    id: m.id,
    label: m.label,
    lastValue: lastByMeter.get(m.id) ?? null,
  }));

  // Where the row actions return to, carrying whatever filter and page the user was looking at.
  const backParams = new URLSearchParams({
    ...(meterFilter ? { meter: meterFilter } : {}),
    ...(reviewOnly ? { review: "1" } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  }).toString();
  const back = `/app/utilities/readings${backParams ? `?${backParams}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">القراءات</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{total} قراءة</span>
          {canData && formMeters.length > 0 && (
            <FormDrawer label="تسجيل قراءة" title="تسجيل قراءة عدّاد">
              <ReadingForm meters={formMeters} fixedMeterId={meterFilter || undefined} />
            </FormDrawer>
          )}
        </div>
      </div>

      <UtilitiesTabs />

      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{sp.error}</p>
      )}

      {meters.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          أضِف <Link href="/app/utilities" className="underline">عدّاداً</Link> أولاً لتسجيل قراءاته.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={reviewOnly ? `/app/utilities/readings${meterFilter ? `?meter=${meterFilter}` : ""}` : `/app/utilities/readings?review=1${meterFilter ? `&meter=${meterFilter}` : ""}`}
          className={
            "rounded-lg border px-3 py-1.5 " +
            (reviewOnly
              ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
              : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800")
          }
        >
          {reviewOnly ? "عرض كل القراءات" : "تحتاج مراجعة فقط"}
        </Link>
        {meterFilter && (
          <>
            <span className="text-slate-500">{meterById.get(meterFilter)?.label ?? "عدّاد محدَّد"}</span>
            <Link href={`/app/utilities/readings${reviewOnly ? "?review=1" : ""}`} className="text-brand hover:underline">
              إزالة التصفية
            </Link>
          </>
        )}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل القراءات: {error.message}
        </p>
      ) : readings.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          {reviewOnly ? "لا توجد قراءات تحتاج مراجعة." : "لا توجد قراءات بعد."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                  <th>التاريخ</th>
                  <th>العدّاد</th>
                  <th>القراءة</th>
                  <th>السابقة</th>
                  <th>الاستهلاك</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {readings.map((r) => (
                  <tr key={r.id} className="[&>td]:px-3 [&>td]:py-2 align-top">
                    <td dir="ltr" className="text-right whitespace-nowrap">{r.reading_date}</td>
                    <td>{meterById.get(r.meter_id)?.label ?? "—"}</td>
                    <td dir="ltr" className="text-right font-medium">{r.value}</td>
                    <td dir="ltr" className="text-right text-slate-500">{r.previous_value ?? "—"}</td>
                    <td>
                      {r.consumption != null ? (
                        <span dir="ltr" className="font-medium">{r.consumption}</span>
                      ) : r.needs_review ? (
                        <Badge tone="warning">تحتاج مراجعة</Badge>
                      ) : (
                        <span className="text-slate-400">قراءة أساس</span>
                      )}
                      {r.is_reset && <span className="mr-2 text-xs text-slate-500">عدّاد جديد</span>}
                      {r.note && <p className="mt-1 text-xs text-slate-400">{r.note}</p>}
                    </td>
                    <td>
                      {canData && (
                        <div className="flex flex-wrap items-center gap-2">
                          {/* The two answers to "lower than the last reading", exactly as §3 frames them. */}
                          {r.needs_review && (
                            <>
                              <form action={markReadingReset}>
                                <input type="hidden" name="reading_id" value={r.id} />
                                <input type="hidden" name="back" value={back} />
                                <button className="text-xs text-brand hover:underline">نعم، عدّاد جديد</button>
                              </form>
                              <form action={updateReadingValue} className="flex items-center gap-1">
                                <input type="hidden" name="reading_id" value={r.id} />
                                <input type="hidden" name="back" value={back} />
                                <label className="sr-only" htmlFor={`value-${r.id}`}>تصحيح القراءة</label>
                                <input
                                  id={`value-${r.id}`}
                                  name="value"
                                  inputMode="decimal"
                                  dir="ltr"
                                  defaultValue={r.value}
                                  className="w-24 rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand dark:border-slate-700"
                                />
                                <button className="text-xs text-brand hover:underline">تصحيح</button>
                              </form>
                            </>
                          )}
                          <form action={deleteReading}>
                            <input type="hidden" name="reading_id" value={r.id} />
                            <input type="hidden" name="back" value={back} />
                            <ConfirmButton
                              message={`حذف قراءة ${r.reading_date}؟ سيُعاد احتساب استهلاك القراءة التالية.`}
                              className="text-xs text-red-600 hover:underline"
                            >
                              حذف
                            </ConfirmButton>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={total}
            q=""
            basePath="/app/utilities/readings"
            params={{ meter: meterFilter || undefined, review: reviewOnly ? "1" : undefined }}
          />
        </>
      )}
    </div>
  );
}
