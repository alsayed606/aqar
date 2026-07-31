import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { fmtDate } from "@/lib/subscription";
import { parseListParams, PAGE_SIZE } from "@/lib/list-params";
import { Badge } from "@/components/ui";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { StatCard } from "@/components/platform/stat-card";

export const dynamic = "force-dynamic";

type Health = {
  window_days: number;
  paid_count: number; failed_count: number; success_rate: number | null;
  paid_halalas: number; refunded_count: number; refunded_halalas: number;
  initiated_stale: number;
  last_paid_at: string | null; last_failed_at: string | null;
  failure_reasons: { reason: string | null; count: number }[];
};
type PaymentRow = {
  id: string; org_id: string; org_name: string; plan_code: string;
  amount_halalas: number; currency: string; gateway: string; gateway_payment_id: string | null;
  status: string; created_at: string; paid_at: string | null;
  failure_reason: string | null; total_count: number;
};

const STATUS_AR: Record<string, string> = {
  initiated: "قيد التنفيذ", paid: "مدفوعة", failed: "فاشلة", refunded: "مُستردّة",
};
const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  initiated: "info", paid: "success", failed: "danger", refunded: "warning",
};
const FILTERS = ["", "paid", "failed", "initiated", "refunded"] as const;
const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";

export default async function BillingCentre({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const { q, page, from } = parseListParams(sp);
  const status = FILTERS.includes((sp.status ?? "") as (typeof FILTERS)[number]) ? sp.status ?? "" : "";

  const supabase = await createClient();
  const [{ data: healthData, error }, { data: paymentsData }] = await Promise.all([
    supabase.rpc("platform_billing_health", { p_days: 30 }),
    supabase.rpc("platform_list_payments", {
      p_search: q || null,
      p_status: status || null,
      p_limit: PAGE_SIZE,
      p_offset: from,
    }),
  ]);

  if (error?.message?.includes("platform_billing_health")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0051</span> لتفعيل مركز الفوترة.
      </p>
    );
  }
  const h = healthData as Health;
  const payments = (paymentsData ?? []) as PaymentRow[];
  const total = payments[0]?.total_count ?? 0;

  const filterHref = (value: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (value) params.set("status", value);
    const query = params.toString();
    return query ? `/platform/billing?${query}` : "/platform/billing";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">مركز الفوترة</h1>
        <p className="text-xs text-slate-500">آخر {h.window_days} يوماً</p>
      </div>

      {/* Gateway health as our own records show it. A live probe of Moyasar would need their API and
          is not claimed here — nothing on this page reports a status we did not observe. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="نسبة نجاح العمليات"
          value={h.success_rate == null ? "—" : `${(h.success_rate * 100).toFixed(1)}%`}
          hint={`${h.paid_count} ناجحة · ${h.failed_count} فاشلة`}
          tone={h.success_rate != null && h.success_rate < 0.9 ? "bad" : "good"}
          unavailable={h.success_rate == null}
        />
        <StatCard label="محصّل خلال الفترة" value={`${halalasToSar(h.paid_halalas)} ر.س`} hint={`آخر تحصيل ${fmtDate(h.last_paid_at)}`} />
        <StatCard
          label="عمليات معلّقة > ٢٤ ساعة"
          value={h.initiated_stale}
          tone={h.initiated_stale > 0 ? "warn" : "default"}
          hint="بدأت ولم يصل عنها إشعار"
        />
        <StatCard label="مستردّات" value={`${h.refunded_count}`} hint={`${halalasToSar(h.refunded_halalas)} ر.س`} />
      </section>

      {h.failed_count > 0 && (
        <section className={cardCls}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">أسباب الفشل</h2>
          <ul className="space-y-1 text-sm">
            {h.failure_reasons.map((f, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-slate-600 dark:text-slate-300" dir="ltr">{f.reason ?? "بلا سبب مذكور من البوابة"}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{f.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-3">
        <ListToolbar q={q} placeholder="بحث باسم المكتب أو مرجع البوابة…" keep={{ status }} />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((value) => (
            <Link
              key={value || "all"}
              href={filterHref(value)}
              className={
                "rounded-full border px-3 py-1 text-xs transition-colors " +
                (status === value
                  ? "border-brand bg-brand text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800")
              }
            >
              {value ? STATUS_AR[value] : "الكل"}
            </Link>
          ))}
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          {q || status ? "لا عملية مطابقة." : "لا مدفوعات بعد."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                  <th>المكتب</th><th>الخطة</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th><th>مرجع البوابة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <Link href={`/platform/tenants/${p.org_id}`} className="font-medium hover:text-brand hover:underline">
                        {p.org_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{p.plan_code}</td>
                    <td className="px-3 py-2 text-left" dir="ltr">{halalasToSar(p.amount_halalas)} {p.currency}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{STATUS_AR[p.status] ?? p.status}</Badge>
                      {p.failure_reason && (
                        <span className="mt-0.5 block max-w-48 truncate text-[11px] text-red-500" dir="ltr" title={p.failure_reason}>
                          {p.failure_reason}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-left text-xs" dir="ltr">{fmtDate(p.paid_at ?? p.created_at)}</td>
                    <td className="px-3 py-2 text-left text-xs text-slate-500" dir="ltr">{p.gateway_payment_id ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} q={q} basePath="/platform/billing" params={{ status }} />
        </>
      )}

      <section className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm dark:border-slate-700">
        <h2 className="mb-2 font-semibold text-slate-700 dark:text-slate-200">غير مبني بعد — بقرار</h2>
        <ul className="list-inside list-disc space-y-1 text-slate-500">
          <li><b>تنفيذ الاسترداد:</b> الحالة «مُستردّة» تُعرض، لكن <b>إصدار</b> استرداد يتطلّب واجهة Moyasar للاسترداد + إشعاراً. وضع الصف «مُستردّاً» في القاعدة دون استرداد فعلي كذبةٌ على دفاترنا.</li>
          <li><b>فواتير ضريبية للمكاتب:</b> نسجّل ما <b>دفعه</b> المكتب لنا، ولا نُصدر له فاتورة. وكمورّد سعودي علينا إصدار فاتورة ضريبية (ZATCA) عن رسوم الاشتراك — <b>فجوة حقيقية</b>، وهي ميزة لا تقرير.</li>
          <li><b>حالة البوابة الحيّة:</b> ما يظهر أعلاه مستخرَج من سجلاتنا نحن. فحص «هل Moyasar تعمل الآن» يحتاج واجهتهم.</li>
        </ul>
      </section>
    </div>
  );
}
