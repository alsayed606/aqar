import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ALERT_META, type AlertRow } from "@/lib/platform";

export const dynamic = "force-dynamic";

const SEVERITY = {
  1: { label: "تصرّف الآن", ring: "border-red-300 dark:border-red-900/60", dot: "bg-red-500" },
  2: { label: "راجعه اليوم", ring: "border-amber-300 dark:border-amber-900/60", dot: "bg-amber-500" },
  3: { label: "للعلم", ring: "border-slate-200 dark:border-slate-800", dot: "bg-slate-400" },
} as const;

export default async function AlertsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_alerts");

  if (error?.message?.includes("platform_alerts")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0052</span> لتفعيل التنبيهات.
      </p>
    );
  }
  // Only non-zero alerts come back from SQL, so an empty list genuinely means nothing is wrong.
  const alerts = (data ?? []) as AlertRow[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">تنبيهات النظام</h1>
        <p className="text-xs text-slate-500">مرتّبة بالأهمية — ما لا يوجد منه شيء لا يُعرض</p>
      </div>

      {alerts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-emerald-300 p-10 text-center text-sm text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-400">
          لا تنبيهات. كل ما نراقبه ضمن الحدود.
        </p>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a) => {
            const meta = ALERT_META[a.kind];
            const sev = SEVERITY[(a.severity as 1 | 2 | 3)] ?? SEVERITY[3];
            return (
              <li key={a.kind}>
                <Link
                  href={meta?.href ?? "/platform"}
                  className={`flex items-start gap-3 rounded-2xl border bg-white p-4 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60 ${sev.ring}`}
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{meta?.title ?? a.kind}</span>
                      <span className="text-[11px] text-slate-400">{sev.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{meta?.hint ?? ""}</p>
                    {Array.isArray(a.detail) && a.detail.length > 0 && (
                      <p className="mt-1 text-[11px] text-slate-400" dir="ltr">{(a.detail as string[]).join(" · ")}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-2xl font-bold tabular-nums text-slate-900 dark:text-white" dir="ltr">
                    {a.count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
