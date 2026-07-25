import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { fmtDate } from "@/lib/subscription";
import { operatorSetSubscription } from "../actions";

export const dynamic = "force-dynamic";

type OrgRow = {
  org_id: string;
  org_name: string;
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
};
type PaymentRow = {
  id: string;
  plan_code: string;
  amount_halalas: number;
  status: string;
  gateway_payment_id: string | null;
  created_at: string;
  paid_at: string | null;
};

const PLANS = ["basic", "pro", "enterprise"];
const STATUSES = ["trialing", "active", "comped", "past_due", "canceled"];

export default async function OperatorOrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { orgId } = await params;
  const { ok, error: flashError } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnTo=/operator/${orgId}`);
  const { data: isOp } = await supabase.rpc("is_platform_operator");
  if (!isOp) notFound();

  const [{ data: orgsData }, { data: paymentsData }] = await Promise.all([
    supabase.rpc("operator_list_orgs"),
    supabase.rpc("operator_list_payments", { p_org: orgId }),
  ]);
  const org = ((orgsData ?? []) as OrgRow[]).find((o) => o.org_id === orgId);
  if (!org) notFound();
  const payments = (paymentsData ?? []) as PaymentRow[];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{org.org_name}</h1>
        <Link href="/operator" className="text-sm text-brand hover:underline">
          → كل المنشآت
        </Link>
      </div>

      {ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          حُدِّث الاشتراك.
        </p>
      )}
      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

      {/* Manual subscription override */}
      <form
        action={operatorSetSubscription}
        className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <input type="hidden" name="org_id" value={orgId} />
        <h2 className="font-semibold">إدارة الاشتراك</h2>
        <p className="text-xs text-neutral-500">اترك الحقل فارغاً لإبقاء قيمته الحالية.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            الخطة <span className="text-neutral-400">(الحالية: {org.plan_code ?? "—"})</span>
            <select name="plan" defaultValue="" className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700">
              <option value="">— بدون تغيير —</option>
              {PLANS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            الحالة <span className="text-neutral-400">(الحالية: {org.status ?? "—"})</span>
            <select name="status" defaultValue="" className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700">
              <option value="">— بدون تغيير —</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            نهاية التجربة <span className="text-neutral-400" dir="ltr">({fmtDate(org.trial_ends_at)})</span>
            <input type="date" name="trial_ends_at" dir="ltr" className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
          </label>
          <label className="block text-sm">
            نهاية الفترة <span className="text-neutral-400" dir="ltr">({fmtDate(org.current_period_end)})</span>
            <input type="date" name="period_end" dir="ltr" className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
          </label>
        </div>
        <label className="block text-sm">
          ملاحظة (سبب المنح/التمديد)
          <input name="notes" className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
        </label>
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg">
          حفظ التغييرات
        </button>
      </form>

      {/* Payment history */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 font-semibold">سجل المدفوعات</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-neutral-500">لا مدفوعات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-neutral-500">
                <tr className="[&>th]:py-1 [&>th]:font-medium">
                  <th>التاريخ</th>
                  <th>الخطة</th>
                  <th>المبلغ</th>
                  <th>الحالة</th>
                  <th>مرجع البوابة</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-neutral-200 [&>td]:py-1.5 dark:border-neutral-800">
                    <td dir="ltr" className="text-left">{fmtDate(p.paid_at ?? p.created_at)}</td>
                    <td>{p.plan_code}</td>
                    <td dir="ltr" className="text-left">{halalasToSar(p.amount_halalas)} ر.س</td>
                    <td>{p.status}</td>
                    <td dir="ltr" className="text-left text-xs text-neutral-500">{p.gateway_payment_id ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
