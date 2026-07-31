import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { StatCard } from "@/components/platform/stat-card";
import { PlanEditor, type PlanRow } from "@/components/platform/plan-editor";

export const dynamic = "force-dynamic";

type Centre = {
  trials: { total: number; expiring_7d: number; expiring_30d: number; lapsed: number };
  renewals: { due_7d: number; due_30d: number; auto_renew_on: number; auto_renew_off: number };
  active_without_card: number;
  stopped: { suspended: number; past_due: number; canceled: number; canceled_30d: number };
};
type DistRow = { plan_code: string; orgs: number; orgs_active: number; mrr_halalas: number };

const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";
const limitText = (v: number | null) => (v === null ? "بلا حد" : String(v));

export default async function SubscriptionCentre({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: centreData, error }, { data: planData }, { data: distData }] = await Promise.all([
    supabase.rpc("platform_subscription_center"),
    supabase.from("plan").select("code, name_ar, price_halalas, max_properties, max_units, max_members, is_public, sort").order("sort"),
    supabase.rpc("platform_plan_distribution"),
  ]);

  if (error?.message?.includes("platform_subscription_center")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0051</span> لتفعيل مركز الاشتراكات.
      </p>
    );
  }
  const c = centreData as Centre;
  const plans = (planData ?? []) as PlanRow[];
  const dist = new Map(((distData ?? []) as DistRow[]).map((d) => [d.plan_code, d]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">مركز الاشتراكات</h1>
        <PlanEditor />
      </div>

      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">حُفظت الخطة.</p>
      )}
      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{sp.error}</p>
      )}

      {/* An active subscription with no saved card cannot renew itself and will lapse silently. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="حسابات تجريبية" value={c.trials.total} hint={`${c.trials.expiring_7d} تنتهي خلال ٧ أيام`} tone={c.trials.expiring_7d > 0 ? "warn" : "default"} />
        <StatCard label="تجارب منقضية بلا قرار" value={c.trials.lapsed} tone={c.trials.lapsed > 0 ? "bad" : "default"} hint="انتهى تاريخها ولم يُبتّ فيها" />
        <StatCard label="تجديدات خلال ٣٠ يوماً" value={c.renewals.due_30d} hint={`${c.renewals.due_7d} خلال ٧ أيام`} />
        <StatCard label="نشط بلا بطاقة محفوظة" value={c.active_without_card} tone={c.active_without_card > 0 ? "warn" : "good"} hint="لن يُجدَّد تلقائياً" />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="التجديد التلقائي مفعّل" value={c.renewals.auto_renew_on} tone="good" />
        <StatCard label="التجديد التلقائي متوقف" value={c.renewals.auto_renew_off} />
        <StatCard label="موقوف / متأخر" value={`${c.stopped.suspended} / ${c.stopped.past_due}`} tone={c.stopped.suspended + c.stopped.past_due > 0 ? "warn" : "default"} />
        <StatCard label="ملغى" value={c.stopped.canceled} hint={`${c.stopped.canceled_30d} خلال ٣٠ يوماً`} />
      </section>

      <section className={cardCls}>
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">كتالوج الخطط</h2>
          <p className="text-[11px] text-slate-400">التسعير والحدود بيانات — تعديلها هنا لا يحتاج هجرة</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-right text-slate-500">
              <tr className="[&>th]:py-2 [&>th]:font-medium">
                <th>الخطة</th><th>السعر</th><th>عقارات</th><th>وحدات</th><th>أعضاء</th><th>مشتركون</th><th>MRR</th><th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const d = dist.get(p.code);
                return (
                  <tr key={p.code} className="border-t border-slate-200 [&>td]:py-2 dark:border-slate-800">
                    <td>
                      <span className="font-medium">{p.name_ar}</span>
                      <span className="block text-[11px] text-slate-400" dir="ltr">{p.code}</span>
                      {!p.is_public && <span className="text-[11px] text-slate-500">غير معروضة في الأسعار</span>}
                    </td>
                    <td dir="ltr" className="text-left">
                      {p.price_halalas === 0 ? "تواصل معنا" : `${halalasToSar(p.price_halalas)} ر.س`}
                    </td>
                    <td dir="ltr" className="text-left">{limitText(p.max_properties)}</td>
                    <td dir="ltr" className="text-left">{limitText(p.max_units)}</td>
                    <td dir="ltr" className="text-left">{limitText(p.max_members)}</td>
                    <td dir="ltr" className="text-left">{d ? `${d.orgs_active} / ${d.orgs}` : "—"}</td>
                    <td dir="ltr" className="text-left">{d ? `${halalasToSar(d.mrr_halalas)} ر.س` : "—"}</td>
                    <td><PlanEditor plan={p} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Two things the console cannot honestly claim yet. Saying so beats a button that lies. */}
      <section className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm dark:border-slate-700">
        <h2 className="mb-2 font-semibold text-slate-700 dark:text-slate-200">غير مبني بعد — بقرار</h2>
        <ul className="list-inside list-disc space-y-1 text-slate-500">
          <li><b>الخصومات والكوبونات:</b> لا يوجد نموذج خصم في القاعدة أصلاً. رمز وقيمة ومدة وتتبّع استخدام = نظام قائم بذاته، ونصفه أسوأ من عدمه.</li>
          <li><b>ميزات لكل خطة:</b> ستُبنى مع إدارة الميزات (T‑5) ليكون لها موضع واحد لا موضعان.</li>
        </ul>
        <p className="mt-2 text-slate-500">
          إدارة اشتراك مكتب بعينه من <Link href="/platform/tenants" className="text-brand hover:underline">صفحة المكاتب</Link>.
        </p>
      </section>
    </div>
  );
}
