import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/subscription";

export const dynamic = "force-dynamic";

type OrgRow = {
  org_id: string;
  org_name: string;
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  properties: number;
  units: number;
  members: number;
};

const STATUS_AR: Record<string, string> = {
  trialing: "تجريبي",
  active: "نشط",
  comped: "ممنوح",
  past_due: "متأخر",
  canceled: "ملغى",
};

export default async function OperatorHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/operator");

  const { data: isOp } = await supabase.rpc("is_platform_operator");
  if (!isOp) notFound();

  const { data, error } = await supabase.rpc("operator_list_orgs");
  const orgs = (data ?? []) as OrgRow[];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">مشغّل المنصّة — المنشآت</h1>
        <span className="text-sm text-neutral-500">{orgs.length} منشأة</span>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error.message}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-right dark:bg-neutral-900">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th>المنشأة</th>
                <th>الخطة</th>
                <th>الحالة</th>
                <th>التجربة</th>
                <th>التجديد</th>
                <th>عقارات/وحدات/أعضاء</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.org_id} className="border-t border-neutral-200 [&>td]:px-3 [&>td]:py-2 dark:border-neutral-800">
                  <td className="font-medium">{o.org_name}</td>
                  <td>{o.plan_code ?? "—"}</td>
                  <td>{o.status ? (STATUS_AR[o.status] ?? o.status) : "—"}</td>
                  <td dir="ltr" className="text-left">{fmtDate(o.trial_ends_at)}</td>
                  <td dir="ltr" className="text-left">{fmtDate(o.current_period_end)}</td>
                  <td dir="ltr" className="text-left">{o.properties} / {o.units} / {o.members}</td>
                  <td>
                    <Link href={`/operator/${o.org_id}`} className="text-brand hover:underline">
                      إدارة ←
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
