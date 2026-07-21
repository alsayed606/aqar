import { checkSupabase } from "@/lib/supabase/health";

// Rendered per-request so the status reflects the live Supabase connection (not build time).
export const dynamic = "force-dynamic";

export default async function Home() {
  const health = await checkSupabase();
  const c = health.checks;

  const Row = ({ label, ok }: { label: string; ok: boolean }) => (
    <li className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-neutral-600 dark:text-neutral-300">{label}</span>
      <span
        className={
          "rounded-full px-2.5 py-0.5 text-xs font-medium " +
          (ok
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
            : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300")
        }
      >
        {ok ? "✓ متصل" : "✗ غير مكتمل"}
      </span>
    </li>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">عقار</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          منصة إدارة الأملاك — المرحلة الثانية: إعداد التطبيق وربطه بقاعدة البيانات.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">حالة الاتصال بـ Supabase</h2>
          <span
            className={
              "rounded-full px-3 py-1 text-sm font-semibold " +
              (health.ok
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300")
            }
          >
            {health.ok ? "جاهز" : "بانتظار الإعداد"}
          </span>
        </div>

        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          <Row label="متغيّرات البيئة (URL + المفتاح)" ok={c.envConfigured} />
          <Row label="الوصول إلى REST API" ok={c.restReachable} />
          <Row label="مخطط app مكشوف" ok={c.appSchemaExposed} />
        </ul>

        {c.note && (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
            {c.note}
          </p>
        )}
        {c.error && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            {c.error}
          </p>
        )}

        <p className="mt-4 text-xs text-neutral-400" dir="ltr">
          {health.supabaseUrl || "SUPABASE_URL not set"}
        </p>
      </section>

      <p className="text-center text-sm text-neutral-500">
        فحص مفصّل بصيغة JSON:{" "}
        <a className="text-brand underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
