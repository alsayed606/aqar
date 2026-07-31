import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/subscription";
import { SUBSCRIPTION_STATUS_AR } from "@/lib/labels";
import { BroadcastComposer } from "@/components/platform/broadcast-composer";

export const dynamic = "force-dynamic";

type BroadcastRow = {
  id: string; title: string; body: string | null;
  audience: { status?: string; plan?: string };
  channel: string; orgs_count: number; emails_count: number; sent_at: string;
};

const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";

function audienceLabel(a: BroadcastRow["audience"]) {
  const parts = [
    a.status ? SUBSCRIPTION_STATUS_AR[a.status] ?? a.status : null,
    a.plan ? `خطة ${a.plan}` : null,
  ].filter(Boolean);
  return parts.length === 0 ? "كل المكاتب" : parts.join(" · ");
}

export default async function BroadcastCentre() {
  const supabase = await createClient();
  const [{ data: historyData, error }, { data: planData }] = await Promise.all([
    supabase.rpc("platform_list_broadcasts", { p_limit: 20 }),
    supabase.from("plan").select("code, name_ar").order("sort"),
  ]);

  if (error?.message?.includes("platform_list_broadcasts")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0054</span> لتفعيل مركز البثّ.
      </p>
    );
  }
  const history = (historyData ?? []) as BroadcastRow[];
  const plans = (planData ?? []) as { code: string; name_ar: string }[];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">مركز البثّ</h1>

      <section className={cardCls}>
        <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">رسالة جديدة</h2>
        <p className="mb-4 text-[11px] text-slate-400">
          احسب الجمهور أولاً. البريد يدخل نفس طابور الإشعارات ويُصرّفه المُصرِّف المجدول — تتابعه في صحة المنصة.
        </p>
        <BroadcastComposer plans={plans} />
      </section>

      <section className={cardCls}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">ما أُرسل سابقاً</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">لم يُرسَل شيء بعد.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map((b) => (
              <li key={b.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{b.title}</span>
                  <span className="text-xs text-slate-400" dir="ltr">{fmtDate(b.sent_at)}</span>
                </div>
                {b.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{b.body}</p>}
                <p className="mt-1 text-[11px] text-slate-400">
                  {audienceLabel(b.audience)} · {b.orgs_count} مكتب
                  {b.channel === "in_app_email" ? ` · ${b.emails_count} بريد` : " · داخل التطبيق فقط"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
