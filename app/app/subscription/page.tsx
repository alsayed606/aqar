import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { fmtDate, type Summary, type SubscriptionStatus } from "@/lib/subscription";

export const dynamic = "force-dynamic";

const STATUS: Record<SubscriptionStatus, { label: string; tone: string }> = {
  trialing: { label: "فترة تجريبية", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  active: { label: "نشط", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  comped: { label: "اشتراك ممنوح", tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" },
  past_due: { label: "متأخر السداد", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  canceled: { label: "ملغى", tone: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
};

const RESOURCES: Array<{ key: keyof Summary["usage"]; label: string }> = [
  { key: "properties", label: "العقارات" },
  { key: "units", label: "الوحدات" },
  { key: "members", label: "أعضاء الفريق" },
];

export default async function SubscriptionPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subscription_summary", { p_org: activeOrg });
  const s = (data ?? null) as Summary | null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">الاشتراك والاستخدام</h1>

      {/* Pre-migration graceful state, and the (unexpected) no-row state. */}
      {error ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          لعرض الاشتراك، طبّق هجرة <span dir="ltr">0036</span> على قاعدة البيانات.
        </p>
      ) : !s ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          لا يوجد اشتراك مسجّل لهذه المنشأة بعد.
        </p>
      ) : (
        <>
          {/* Plan + status card */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">خطة {s.plan_name}</span>
                  <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + STATUS[s.status].tone}>
                    {STATUS[s.status].label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {s.price_halalas > 0 ? (
                    <>
                      <span dir="ltr">{halalasToSar(s.price_halalas)}</span> ر.س / شهرياً
                    </>
                  ) : (
                    "السعر حسب الطلب"
                  )}
                </p>
              </div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400">
                {s.status === "trialing" && (
                  <span>
                    تنتهي التجربة: <span dir="ltr">{fmtDate(s.trial_ends_at)}</span>
                  </span>
                )}
                {s.status === "active" && s.current_period_end && (
                  <span>
                    التجديد القادم: <span dir="ltr">{fmtDate(s.current_period_end)}</span>
                  </span>
                )}
              </div>
            </div>

            {!s.active && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
                اشتراكك غير مُفعّل حالياً، لذلك توقّف إنشاء عناصر جديدة (عقارات، وحدات، عقود، أعضاء). بياناتك محفوظة
                ويمكن الاطلاع عليها وتعديلها. لتفعيل الاشتراك تواصل مع فريق عقار.
              </p>
            )}
          </div>

          {/* Usage vs limits */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-4 font-semibold">الاستخدام مقابل حدود الخطة</h2>
            <ul className="space-y-4">
              {RESOURCES.map(({ key, label }) => {
                const used = s.usage[key];
                const limit = s.limits[key];
                const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                const atLimit = limit != null && used >= limit;
                return (
                  <li key={key}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{label}</span>
                      <span className={atLimit ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-400"}>
                        <span dir="ltr">{used}</span> / {limit == null ? "غير محدود" : <span dir="ltr">{limit}</span>}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                      <div
                        className={"h-full rounded-full " + (atLimit ? "bg-red-500" : "bg-brand")}
                        style={{ width: limit == null ? "8%" : `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            الفوترة حالياً يدوية. للترقية أو تفعيل/تجديد الاشتراك، تواصل مع فريق عقار وسنقوم بتحديث خطتك.
          </p>
        </>
      )}
    </div>
  );
}
