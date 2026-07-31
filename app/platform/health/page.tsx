import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/subscription";
import { StatCard } from "@/components/platform/stat-card";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

type Health = {
  email_queue: { pending: number; failed: number; sent_24h: number; overdue: number; oldest_pending_at: string | null };
  notifications: { total_24h: number; unread: number };
  cron: { job: string; last_run_at: string; ok: boolean; duration_ms: number | null; error: string | null; failures_24h: number }[];
  payments: { paid_24h: number; failed_24h: number; awaiting_webhook: number; last_webhook_at: string | null };
  imports: { batches_24h: number; stuck: number };
  generated_at: string;
};

const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";

// Subsystems that live outside this database. We could draw a green dot for each of them, and it
// would mean nothing: we have not observed them. Naming them as unmeasured, with the place to go
// look, is the honest version — and it is also the to-do list for wiring real probes.
const EXTERNAL = [
  { name: "قاعدة البيانات (Supabase)", where: "لوحة Supabase → Database", why: "الاتصال يعمل بدليل أن هذه الصفحة ظهرت، لكن الاستخدام والنسخ الاحتياطي خارج قاعدتنا" },
  { name: "التخزين (Storage)", where: "لوحة Supabase → Storage", why: "لم يُفعّل بعد في النظام" },
  { name: "دوال الحافة (Edge Functions)", where: "لوحة Supabase → Edge Functions", why: "سجلّاتها عند المزوّد" },
  { name: "زمن التشغيل (Vercel)", where: "لوحة Vercel → Deployments", why: "حالة النشر والأخطاء عند المزوّد" },
  { name: "معدّل الأخطاء البرمجية", where: "لم يُركَّب بعد", why: "يحتاج Sentry أو ما يعادله — لا سجلّ أخطاء تطبيقي اليوم" },
  { name: "توفّر بوابة الدفع", where: "حالة Moyasar", why: "ما نعرضه في مركز الفوترة مستخرَج من سجلّاتنا، لا فحص حيّ لهم" },
];

export default async function HealthPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_health");

  if (error?.message?.includes("platform_health")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0052</span> لتفعيل صحة المنصة.
      </p>
    );
  }
  const h = data as Health;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">صحة المنصة</h1>
        <p className="text-xs text-slate-500" dir="ltr">{fmtDate(h.generated_at)}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="بريد بانتظار الإرسال" value={h.email_queue.pending} hint={`${h.email_queue.sent_24h} أُرسل خلال ٢٤ ساعة`} tone={h.email_queue.overdue > 0 ? "warn" : "default"} />
        <StatCard label="بريد فشل نهائياً" value={h.email_queue.failed} tone={h.email_queue.failed > 0 ? "bad" : "good"} />
        <StatCard label="مدفوعات ٢٤ ساعة" value={`${h.payments.paid_24h} / ${h.payments.failed_24h}`} hint="ناجحة / فاشلة" />
        <StatCard
          label="بانتظار إشعار البوابة"
          value={h.payments.awaiting_webhook}
          tone={h.payments.awaiting_webhook > 0 ? "warn" : "good"}
          hint={`آخر إشعار ${fmtDate(h.payments.last_webhook_at)}`}
        />
      </section>

      <section className={cardCls}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">المهام المجدولة</h2>
        {h.cron.length === 0 ? (
          // Before 0052 nothing recorded a run, so an empty table is "not yet observed", not "never ran".
          <p className="text-sm text-slate-500">
            لم تُسجَّل أي دورة بعد. التسجيل بدأ مع الهجرة <span dir="ltr">0052</span> — ستظهر هنا بعد أول تشغيل مجدول.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-slate-500">
                <tr className="[&>th]:py-1 [&>th]:font-medium">
                  <th>المهمة</th><th>آخر تشغيل</th><th>النتيجة</th><th>المدة</th><th>إخفاقات ٢٤ ساعة</th>
                </tr>
              </thead>
              <tbody>
                {h.cron.map((c) => (
                  <tr key={c.job} className="border-t border-slate-200 [&>td]:py-2 dark:border-slate-800">
                    <td dir="ltr" className="text-left font-medium">{c.job}</td>
                    <td dir="ltr" className="text-left text-xs">{fmtDate(c.last_run_at)}</td>
                    <td>
                      <Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "نجحت" : "فشلت"}</Badge>
                      {c.error && <span className="mt-0.5 block max-w-64 truncate text-[11px] text-red-500" dir="ltr" title={c.error}>{c.error}</span>}
                    </td>
                    <td dir="ltr" className="text-left text-xs">{c.duration_ms == null ? "—" : `${c.duration_ms} ms`}</td>
                    <td dir="ltr" className="text-left">{c.failures_24h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className={cardCls}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">الإشعارات والطوابير</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {[
              ["إشعارات خلال ٢٤ ساعة", h.notifications.total_24h],
              ["غير مقروءة", h.notifications.unread],
              ["بريد متأخر عن موعده", h.email_queue.overdue],
              ["أقدم رسالة معلّقة", fmtDate(h.email_queue.oldest_pending_at)],
              ["دفعات استيراد ٢٤ ساعة", h.imports.batches_24h],
              ["استيراد عالق > ٧ أيام", h.imports.stuck],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="font-bold text-slate-900 dark:text-white" dir="ltr">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-2xl border border-dashed border-slate-300 p-5 dark:border-slate-700">
          <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">خارج قياسنا</h2>
          <p className="mb-3 text-[11px] text-slate-400">
            نقطة خضراء لم نرصدها أسوأ من لا نقطة. هذه أنظمة خارج قاعدتنا — تُفحص عند مزوّدها.
          </p>
          <ul className="space-y-2 text-sm">
            {EXTERNAL.map((e) => (
              <li key={e.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-200">{e.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{e.where}</span>
                </div>
                <p className="text-[11px] text-slate-400">{e.why}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
