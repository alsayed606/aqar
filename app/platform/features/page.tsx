import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { saveFlag } from "../actions";

export const dynamic = "force-dynamic";

type FlagRow = {
  key: string; label_ar: string; description: string | null;
  is_enabled: boolean; rollout_percent: number; required_plan: string | null; is_beta: boolean;
  overrides_on: number; overrides_off: number;
};

const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";
const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700";

function FlagForm({ flag, plans }: { flag?: FlagRow; plans: { code: string; name_ar: string }[] }) {
  const isNew = !flag;
  return (
    <form action={saveFlag} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          المفتاح <span className="text-slate-400">(إنجليزي صغير)</span>
          <input name="key" dir="ltr" required defaultValue={flag?.key ?? ""} readOnly={!isNew}
            className={fieldCls + (isNew ? "" : " text-slate-400")} />
        </label>
        <label className="block text-sm">
          الاسم المعروض
          <input name="label_ar" required defaultValue={flag?.label_ar ?? ""} className={fieldCls} />
        </label>
      </div>
      <label className="block text-sm">
        الوصف
        <input name="description" defaultValue={flag?.description ?? ""} className={fieldCls} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          نسبة الإطلاق التدريجي %
          <input name="rollout_percent" type="number" min="0" max="100" dir="ltr"
            defaultValue={flag?.rollout_percent ?? 0} className={fieldCls} />
        </label>
        <label className="block text-sm">
          الخطة المطلوبة
          <select name="required_plan" defaultValue={flag?.required_plan ?? ""} className={fieldCls}>
            <option value="">كل الخطط</option>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name_ar}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-4 pb-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_enabled" defaultChecked={flag?.is_enabled ?? false} className="h-4 w-4" />
            مفعّلة للجميع
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_beta" defaultChecked={flag?.is_beta ?? false} className="h-4 w-4" />
            تجريبية
          </label>
        </div>
      </div>
      <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg">
        {isNew ? "إضافة الميزة" : "حفظ"}
      </button>
    </form>
  );
}

export default async function FeaturesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: planData }] = await Promise.all([
    supabase.rpc("platform_list_flags"),
    supabase.from("plan").select("code, name_ar").order("sort"),
  ]);

  if (error?.message?.includes("platform_list_flags")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0054</span> لتفعيل إدارة الميزات.
      </p>
    );
  }
  const flags = (data ?? []) as FlagRow[];
  const plans = (planData ?? []) as { code: string; name_ar: string }[];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">إدارة الميزات</h1>

      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">حُفظت الميزة.</p>
      )}
      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{sp.error}</p>
      )}

      {/* The resolution order decides what an office actually sees; stating it here saves an
          operator from wondering why a globally enabled flag is off for one customer. */}
      <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        ترتيب الحسم لكل مكتب: <b>استثناء المكتب</b> (إن وُجد) ← <b>الخطة المطلوبة</b> ← <b>مفعّلة للجميع</b> ←
        <b> نسبة الإطلاق</b>. وما لا مفتاح له <b>مغلق</b> دائماً. والنسبة ثابتة لكل مكتب فلا تتذبذب بين طلب وآخر.
      </p>

      {flags.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          لا ميزات معرّفة بعد.
        </p>
      ) : (
        <ul className="space-y-3">
          {flags.map((f) => (
            <li key={f.key} className={cardCls}>
              <div className="mb-3 flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{f.label_ar}</span>
                <span className="text-[11px] text-slate-400" dir="ltr">{f.key}</span>
                {f.is_beta && <Badge tone="info">تجريبية</Badge>}
                {f.is_enabled ? <Badge tone="success">مفعّلة</Badge> : f.rollout_percent > 0 ? (
                  <Badge tone="warning">إطلاق {f.rollout_percent}%</Badge>
                ) : (
                  <Badge tone="neutral">مغلقة</Badge>
                )}
                {f.required_plan && <Badge tone="brand">تتطلّب {f.required_plan}</Badge>}
                {(f.overrides_on > 0 || f.overrides_off > 0) && (
                  <span className="text-[11px] text-slate-400">
                    استثناءات: {f.overrides_on} تشغيل · {f.overrides_off} إيقاف
                  </span>
                )}
              </div>
              <FlagForm flag={f} plans={plans} />
            </li>
          ))}
        </ul>
      )}

      <section className={cardCls}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">ميزة جديدة</h2>
        <FlagForm plans={plans} />
      </section>
    </div>
  );
}
