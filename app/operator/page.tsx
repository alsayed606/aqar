import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/subscription";
import { Badge } from "@/components/ui";
import { FilterableTable } from "@/components/filterable-list";
import { OperatorEditDrawer } from "@/components/operator-edit-drawer";

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

const STATUS_TONE: Record<string, "info" | "success" | "brand" | "warning" | "danger"> = {
  trialing: "info",
  active: "success",
  comped: "brand",
  past_due: "warning",
  canceled: "danger",
};

export default async function OperatorHome({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error: flashError } = await searchParams;
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
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">مشغّل المنصّة — المنشآت</h1>
        <span className="text-sm text-slate-500">{orgs.length} منشأة</span>
      </div>

      {ok && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">حُدِّث الاشتراك.</p>
      )}
      {flashError && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>
      )}

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error.message}</p>
      ) : orgs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">لا توجد منشآت.</p>
      ) : (
        <FilterableTable
          placeholder="بحث بالاسم أو الخطة أو الحالة…"
          headers={
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
              <th>المنشأة</th>
              <th>الخطة</th>
              <th>الحالة</th>
              <th>التجربة</th>
              <th>التجديد</th>
              <th>عقارات/وحدات/أعضاء</th>
              <th></th>
            </tr>
          }
          rows={orgs.map((o) => ({
            id: o.org_id,
            search: [o.org_name, o.plan_code, o.status, STATUS_AR[o.status ?? ""] ?? ""].filter(Boolean).join(" "),
            cells: (
              <>
                <td className="px-3 py-2 font-medium">{o.org_name}</td>
                <td className="px-3 py-2">{o.plan_code ?? "—"}</td>
                <td className="px-3 py-2">
                  {o.status ? <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{STATUS_AR[o.status] ?? o.status}</Badge> : "—"}
                </td>
                <td className="px-3 py-2 text-left" dir="ltr">{fmtDate(o.trial_ends_at)}</td>
                <td className="px-3 py-2 text-left" dir="ltr">{fmtDate(o.current_period_end)}</td>
                <td className="px-3 py-2 text-left" dir="ltr">{o.properties} / {o.units} / {o.members}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <OperatorEditDrawer org={o} />
                    <Link href={`/operator/${o.org_id}`} className="text-xs text-slate-500 hover:text-brand hover:underline">التفاصيل ←</Link>
                  </div>
                </td>
              </>
            ),
          }))}
        />
      )}
    </main>
  );
}
