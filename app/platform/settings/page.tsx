import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/subscription";
import { Badge } from "@/components/ui";
import { saveSetting } from "../actions";

export const dynamic = "force-dynamic";

type SettingRow = { key: string; value: unknown; label_ar: string; updated_at: string };

const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";
const NUMERIC_KEYS = new Set(["trial_days"]);
const HINTS: Record<string, string> = {
  trial_days: "يسري على المكاتب الجديدة فقط — لا يمسّ تجربة قائمة.",
  default_plan: "الخطة التي يبدأ عليها أي مكتب جديد.",
  support_email: "يظهر للعملاء في صفحات النظام.",
  support_phone: "اتركه فارغاً إن لم يكن هناك رقم دعم.",
  broadcast_from: "الاسم الذي يظهر مُرسِلاً في رسائل البثّ.",
};

// Provider keys are ENVIRONMENT, not settings. A console that could read or write them would turn
// one compromised operator account into a compromised payment account — so this page reports only
// whether each is configured and never its value. `Boolean(process.env.X)` runs on the server and
// the value itself never reaches the browser.
const ENV_KEYS: { label: string; name: string; note: string }[] = [
  { label: "قاعدة البيانات (Supabase URL)", name: "NEXT_PUBLIC_SUPABASE_URL", note: "الاتصال العام" },
  { label: "مفتاح الخدمة (service_role)", name: "SUPABASE_SERVICE_ROLE_KEY", note: "الـcron والـwebhook فقط" },
  { label: "بوابة الدفع (Moyasar)", name: "MOYASAR_SECRET_KEY", note: "التحصيل والتجديد" },
  { label: "سرّ إشعار الدفع", name: "MOYASAR_WEBHOOK_SECRET", note: "التحقق من صحة الإشعار" },
  { label: "البريد (Resend)", name: "RESEND_API_KEY", note: "إرسال الإشعارات" },
  { label: "سرّ المهام المجدولة", name: "CRON_SECRET", note: "يحمي مسارات الـcron" },
];

export default async function PlatformSettings({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_settings");

  if (error?.message?.includes("platform_settings")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0054</span> لتفعيل إعدادات المنصة.
      </p>
    );
  }
  const settings = (data ?? []) as SettingRow[];
  const env = ENV_KEYS.map((e) => ({ ...e, set: Boolean(process.env[e.name]) }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">إعدادات المنصة</h1>

      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">حُفظ الإعداد.</p>
      )}
      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{sp.error}</p>
      )}

      <section className={cardCls}>
        <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">إعدادات قابلة للتعديل</h2>
        <p className="mb-4 text-[11px] text-slate-400">
          هذه كانت تحتاج هجرة لتغييرها. أسعار الخطط وحدودها في <span className="text-slate-500">مركز الاشتراكات</span>.
        </p>
        <ul className="space-y-4">
          {settings.map((s) => {
            const numeric = NUMERIC_KEYS.has(s.key);
            const current = typeof s.value === "string" ? s.value : JSON.stringify(s.value);
            return (
              <li key={s.key} className="border-t border-slate-100 pt-4 first:border-0 first:pt-0 dark:border-slate-800">
                <form action={saveSetting} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="key" value={s.key} />
                  <input type="hidden" name="kind" value={numeric ? "number" : "text"} />
                  <label className="block flex-1 text-sm">
                    {s.label_ar}
                    <span className="ms-2 text-[11px] text-slate-400" dir="ltr">{s.key}</span>
                    <input
                      name="value"
                      type={numeric ? "number" : "text"}
                      dir={numeric ? "ltr" : undefined}
                      defaultValue={current}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
                    />
                  </label>
                  <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg">حفظ</button>
                </form>
                <p className="mt-1 text-[11px] text-slate-400">
                  {HINTS[s.key] ?? ""} <span dir="ltr">آخر تعديل {fmtDate(s.updated_at)}</span>
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={cardCls}>
        <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">مفاتيح المزوّدين</h2>
        <p className="mb-4 text-[11px] text-slate-400">
          هذه <b>ليست إعدادات</b> بل متغيّرات بيئة. لوحةٌ تقرأها أو تكتبها تحوّل اختراق حساب مشغّل واحد إلى
          اختراق حساب الدفع — فتُعرض هنا <b>حالتها فقط</b>، ولا تُقرأ قيمتها أبداً. تُضبط في Vercel.
        </p>
        <ul className="space-y-2 text-sm">
          {env.map((e) => (
            <li key={e.name} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                {e.label}
                <span className="ms-2 text-[11px] text-slate-400" dir="ltr">{e.name}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">{e.note}</span>
                {e.set ? <Badge tone="success">مضبوط</Badge> : <Badge tone="danger">غير مضبوط</Badge>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
