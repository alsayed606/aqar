import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { MeterForm } from "@/components/meter-form";
import { ConfirmButton } from "@/components/confirm-button";
import { FormDrawer } from "@/components/form-drawer";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FilterableTable } from "@/components/filterable-list";
import { Badge } from "@/components/ui";
import { parseListParams, likePattern } from "@/lib/list-params";
import { UTILITY_TYPE_AR, METER_STATUS_AR } from "@/lib/labels";
import { deleteMeter, setMeterStatus } from "./actions";
import { UtilitiesTabs } from "@/components/utilities-tabs";
import { loadMeterProperties } from "./queries";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  inactive: "neutral",
  removed: "warning",
};

export default async function MetersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; error?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to } = parseListParams(await searchParams);
  const { error: flashError } = await searchParams;
  const caps = await getCapabilities(activeOrg);
  const canData = caps.has("manage_data");

  const supabase = await createClient();
  let metersQuery = supabase
    .from("utility_meter")
    .select(
      "id, utility_type, meter_number, provider, status, meter_level, property_id, unit_id, property:property_id(name), unit:unit_id(unit_number)",
      { count: "exact" },
    )
    .is("deleted_at", null);
  if (q) metersQuery = metersQuery.ilike("meter_number", likePattern(q));

  const [{ data, error, count }, properties] = await Promise.all([
    metersQuery.order("created_at", { ascending: false }).range(from, to),
    loadMeterProperties(),
  ]);

  const meters = (data ?? []) as any[];
  const total = count ?? 0;

  // Latest reading per visible meter — one query, not one per row.
  const lastByMeter = new Map<string, { reading_date: string; value: number }>();
  const ids = meters.map((m) => m.id);
  if (ids.length) {
    const { data: readings } = await supabase
      .from("utility_reading")
      .select("meter_id, reading_date, value")
      .in("meter_id", ids)
      .is("deleted_at", null)
      .order("reading_date", { ascending: false });
    for (const r of readings ?? []) {
      if (!lastByMeter.has(r.meter_id)) lastByMeter.set(r.meter_id, { reading_date: r.reading_date, value: r.value });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">العدادات</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{total} عدّاد</span>
          {canData && properties.length > 0 && (
            <FormDrawer label="إضافة عدّاد" title="إضافة عدّاد">
              <MeterForm properties={properties} />
            </FormDrawer>
          )}
        </div>
      </div>

      <UtilitiesTabs />

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>
      )}

      {properties.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          أضِف <Link href="/app/properties" className="underline">عقاراً</Link> أولاً لربط العدّاد به.
        </p>
      )}

      <ListToolbar q={q} placeholder="بحث برقم العدّاد…" />

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل العدادات: {error.message}
        </p>
      ) : meters.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا توجد عدادات بعد. العدادات اختيارية — أضِفها عند الحاجة."}
        </p>
      ) : (
        <>
          <FilterableTable
            placeholder="تصفية سريعة في هذه الصفحة…"
            headers={
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                <th>رقم العدّاد</th>
                <th>النوع</th>
                <th>العقار</th>
                <th>يخدم</th>
                <th>آخر قراءة</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            }
            rows={meters.map((m) => {
              const propertyName = first(m.property)?.name ?? "—";
              const unitNumber = first(m.unit)?.unit_number ?? null;
              const serves = unitNumber ? `وحدة ${unitNumber}` : "العقار كاملاً (رئيسي)";
              const last = lastByMeter.get(m.id);
              return {
                id: m.id,
                search: [m.meter_number, propertyName, unitNumber, m.provider, UTILITY_TYPE_AR[m.utility_type]]
                  .filter(Boolean)
                  .join(" "),
                cells: (
                  <>
                    <td dir="ltr" className="px-3 py-2 text-right font-medium">{m.meter_number}</td>
                    <td className="px-3 py-2">{UTILITY_TYPE_AR[m.utility_type] ?? m.utility_type}</td>
                    <td className="px-3 py-2">
                      <Link href={`/app/properties/${m.property_id}`} className="hover:text-brand hover:underline">
                        {propertyName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{serves}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {last ? (
                        <span dir="ltr">{last.value} · {last.reading_date}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{METER_STATUS_AR[m.status] ?? m.status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/app/utilities/readings?meter=${m.id}`} className="text-xs text-brand hover:underline">
                          القراءات
                        </Link>
                        {canData && (
                          <>
                            <form action={setMeterStatus} className="flex items-center gap-1">
                              <input type="hidden" name="meter_id" value={m.id} />
                              <input type="hidden" name="property_id" value={m.property_id} />
                              <label className="sr-only" htmlFor={`status-${m.id}`}>حالة العدّاد</label>
                              <select
                                id={`status-${m.id}`}
                                name="status"
                                defaultValue={m.status}
                                className="rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand dark:border-slate-700"
                              >
                                {Object.entries(METER_STATUS_AR).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                              <button className="text-xs text-brand hover:underline">حفظ</button>
                            </form>
                            <form action={deleteMeter}>
                              <input type="hidden" name="meter_id" value={m.id} />
                              <input type="hidden" name="property_id" value={m.property_id} />
                              <ConfirmButton
                                message={`حذف العدّاد «${m.meter_number}»؟ تبقى قراءاته في السجلّات.`}
                                className="text-xs text-red-600 hover:underline"
                              >
                                حذف
                              </ConfirmButton>
                            </form>
                          </>
                        )}
                      </div>
                    </td>
                  </>
                ),
              };
            })}
          />
          <Pagination page={page} total={total} q={q} basePath="/app/utilities" />
        </>
      )}
    </div>
  );
}
