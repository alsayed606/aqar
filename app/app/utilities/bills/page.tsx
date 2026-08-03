import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { BillForm, type BillMeter } from "@/components/bill-form";
import { ConfirmButton } from "@/components/confirm-button";
import { FormDrawer } from "@/components/form-drawer";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui";
import { UtilitiesTabs } from "@/components/utilities-tabs";
import { meterLabel } from "@/lib/utilities";
import { halalasToSar } from "@/lib/money";
import { UTILITY_TYPE_AR } from "@/lib/labels";
import { PAGE_SIZE } from "@/lib/list-params";
import { clearBillPaid, deleteBill, markBillPaid } from "../actions";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type BillRow = {
  id: string;
  meter_id: string;
  billing_month: string;
  previous_reading: number | null;
  current_reading: number | null;
  consumption: number | null;
  needs_review: boolean;
  total_halalas: number;
  due_date: string | null;
  paid_at: string | null;
  is_paid: boolean;
  is_overdue: boolean;
  utility_type: string;
  meter_number: string;
  meter_level: string;
  property_id: string;
  property_name: string;
  unit_number: string | null;
  bearer_kind: "tenant" | "owner";
  bearer_name: string | null;
  contract_id: string | null;
  bearer_ambiguous: boolean;
};

const FILTERS = [
  { key: "", label: "الكل" },
  { key: "unpaid", label: "غير مسدَّدة" },
  { key: "overdue", label: "متأخّرة" },
  { key: "paid", label: "مسدَّدة" },
];

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ meter?: string; status?: string; page?: string; error?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const sp = await searchParams;
  const meterFilter = (sp.meter ?? "").trim();
  const status = FILTERS.some((f) => f.key === sp.status) ? (sp.status ?? "") : "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const caps = await getCapabilities(activeOrg);
  const canData = caps.has("manage_data");

  const supabase = await createClient();

  // Everything the screen shows about a bill — the total, the consumption, and who bears it — comes
  // from this one view. Resolving the bearer row by row would be a query per bill.
  let billsQuery = supabase.from("utility_bill_view").select("*", { count: "exact" });
  if (meterFilter) billsQuery = billsQuery.eq("meter_id", meterFilter);
  if (status === "paid") billsQuery = billsQuery.eq("is_paid", true);
  if (status === "unpaid") billsQuery = billsQuery.eq("is_paid", false);
  if (status === "overdue") billsQuery = billsQuery.eq("is_overdue", true);

  const [{ data, error, count }, { data: meterData }] = await Promise.all([
    billsQuery.order("billing_month", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    supabase
      .from("utility_meter")
      .select("id, utility_type, meter_number, status, property:property_id(name), unit:unit_id(unit_number)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const bills = (data ?? []) as BillRow[];
  const total = count ?? 0;

  // A removed meter still has last month's bill to record, so unlike readings the picker is not
  // narrowed to active meters.
  const formMeters: BillMeter[] = (meterData ?? []).map((m: any) => ({
    id: m.id,
    label: meterLabel({
      utility_type: m.utility_type,
      meter_number: m.meter_number,
      unit_number: first(m.unit)?.unit_number ?? null,
      property_name: first(m.property)?.name ?? null,
    }),
  }));
  const meterLabelById = new Map(formMeters.map((m) => [m.id, m.label]));

  // Changing one filter keeps the others. `page` is carried only into `back`, so an action returns
  // the user to the page they acted on.
  const href = (next: { status?: string; meter?: string; page?: number }) => {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const m = next.meter ?? meterFilter;
    if (s) params.set("status", s);
    if (m) params.set("meter", m);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return `/app/utilities/bills${qs ? `?${qs}` : ""}`;
  };
  const back = href({ page });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">فواتير المرافق</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{total} فاتورة</span>
          {canData && formMeters.length > 0 && (
            <FormDrawer label="إضافة فاتورة" title="إضافة فاتورة مرافق">
              <BillForm meters={formMeters} fixedMeterId={meterFilter || undefined} />
            </FormDrawer>
          )}
        </div>
      </div>

      <UtilitiesTabs />

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
        الفواتير هنا <strong>سجلّ فقط بلا أثر مالي</strong>: لا تُنشئ استحقاقاً على المستأجر ولا تدخل في
        كشف المالك. تُظهر من يتحمّلها ليُطالَب خارج النظام.
      </p>

      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{sp.error}</p>
      )}

      {formMeters.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          أضِف <Link href="/app/utilities" className="underline">عدّاداً</Link> أولاً لتسجيل فواتيره.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.key || "all"}
            href={href({ status: f.key })}
            className={
              "rounded-lg border px-3 py-1.5 " +
              (status === f.key
                ? "border-brand bg-brand/10 font-medium text-brand"
                : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800")
            }
          >
            {f.label}
          </Link>
        ))}
        {meterFilter && (
          <>
            <span className="text-slate-500">{meterLabelById.get(meterFilter) ?? "عدّاد محدَّد"}</span>
            <Link href={href({ meter: "" })} className="text-brand hover:underline">إزالة التصفية</Link>
          </>
        )}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل الفواتير: {error.message}
        </p>
      ) : bills.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          لا توجد فواتير مطابقة.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                  <th>الشهر</th>
                  <th>العدّاد</th>
                  <th>الاستهلاك</th>
                  <th>الإجمالي</th>
                  <th>يتحمّلها</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {bills.map((b) => (
                  <tr key={b.id} className="[&>td]:px-3 [&>td]:py-2 align-top">
                    <td dir="ltr" className="text-right whitespace-nowrap">{b.billing_month.slice(0, 7)}</td>
                    <td>
                      <span className="font-medium" dir="ltr">{b.meter_number}</span>
                      <p className="text-xs text-slate-500">
                        {UTILITY_TYPE_AR[b.utility_type] ?? b.utility_type} ·{" "}
                        <Link href={`/app/properties/${b.property_id}`} className="hover:text-brand hover:underline">
                          {b.property_name}
                        </Link>
                        {b.unit_number ? ` · وحدة ${b.unit_number}` : " · رئيسي"}
                      </p>
                    </td>
                    <td>
                      {b.consumption != null ? (
                        <span dir="ltr">{b.consumption}</span>
                      ) : b.needs_review ? (
                        <Badge tone="warning">تحتاج مراجعة</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td dir="ltr" className="text-right font-medium whitespace-nowrap">
                      {halalasToSar(b.total_halalas)} ر.س
                    </td>
                    <td>
                      {/* Derived from the contract in force at the end of the billed month — never
                          entered, and never resolved against today. */}
                      <span className="font-medium">{b.bearer_name ?? "—"}</span>
                      <p className="text-xs text-slate-500">
                        {b.bearer_kind === "tenant" ? "المستأجر" : "مالك العقار"}
                        {b.bearer_kind === "owner" && b.meter_level === "unit" && " (الوحدة شاغرة ذلك الشهر)"}
                      </p>
                      {b.bearer_ambiguous && (
                        <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                          ⚠️ تغيّر المستأجر خلال هذه الفترة — اعتُمد عقد آخر الشهر. التوزيع النسبي يدوي.
                        </p>
                      )}
                      {b.contract_id && (
                        <Link href={`/app/contracts/${b.contract_id}`} className="text-xs text-brand hover:underline">
                          العقد ←
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {b.is_paid ? (
                        <Badge tone="success">مسدَّدة</Badge>
                      ) : b.is_overdue ? (
                        <Badge tone="danger">متأخّرة</Badge>
                      ) : (
                        <Badge tone="neutral">غير مسدَّدة</Badge>
                      )}
                      <p className="mt-1 text-xs text-slate-500" dir="ltr">
                        {b.is_paid ? b.paid_at : b.due_date ?? "—"}
                      </p>
                    </td>
                    <td>
                      {canData && (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={b.is_paid ? clearBillPaid : markBillPaid}>
                            <input type="hidden" name="bill_id" value={b.id} />
                            <input type="hidden" name="back" value={back} />
                            <button className="text-xs text-brand hover:underline">
                              {b.is_paid ? "إلغاء السداد" : "تعليم مسدَّدة"}
                            </button>
                          </form>
                          <form action={deleteBill}>
                            <input type="hidden" name="bill_id" value={b.id} />
                            <input type="hidden" name="back" value={back} />
                            <ConfirmButton
                              message={`حذف فاتورة ${b.billing_month.slice(0, 7)} للعدّاد ${b.meter_number}؟`}
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
            basePath="/app/utilities/bills"
            params={{ meter: meterFilter || undefined, status: status || undefined }}
          />
        </>
      )}
    </div>
  );
}
