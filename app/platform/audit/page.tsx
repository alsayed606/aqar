import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/subscription";
import { parseListParams, PAGE_SIZE } from "@/lib/list-params";
import { Badge } from "@/components/ui";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FilterChips } from "@/components/platform/filter-chips";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: number;
  created_at: string;
  action: string;
  org_id: string | null;
  org_name: string | null;
  identity_id: string | null;
  actor_name: string | null;
  is_platform_action: boolean;
  entity_type: string | null;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  total_count: number;
};
type ActionRow = { action: string; count: number };

export default async function AuditCentre({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; action?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const { q, page, from: offset } = parseListParams(sp);
  const platformOnly = sp.scope === "platform";
  const action = (sp.action ?? "").trim();

  const supabase = await createClient();
  const [{ data, error }, { data: actionData }] = await Promise.all([
    supabase.rpc("platform_list_audit", {
      p_action: action || null,
      p_search: q || null,
      p_platform_only: platformOnly,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    }),
    supabase.rpc("platform_audit_actions"),
  ]);

  if (error?.message?.includes("platform_list_audit")) {
    return (
      <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
        طبّق الهجرة <span dir="ltr">0052</span> لتفعيل مركز التدقيق.
      </p>
    );
  }
  const rows = (data ?? []) as AuditRow[];
  const total = rows[0]?.total_count ?? 0;
  const actions = (actionData ?? []) as ActionRow[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">مركز التدقيق</h1>
        <span className="text-sm text-slate-500">{total} عملية</span>
      </div>

      {/* The isolation line, stated where an operator will read it. */}
      <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        عمليات المنصة تُعرض بتفاصيلها الكاملة — فهي سجلّنا نحن. أما عمليات المكاتب فيظهر منها
        <b> من فعل ماذا ولأي مكتب ومتى</b>، دون محتوى العملية: قد يحمل أرقام المكتب وبيانات عملائه.
      </p>

      <div className="space-y-3">
        <ListToolbar q={q} placeholder="بحث بالعملية أو المكتب أو المنفِّذ…" keep={{ action, scope: sp.scope }} />
        <FilterChips
          basePath="/platform/audit"
          param="scope"
          active={platformOnly ? "platform" : ""}
          keep={{ q, action }}
          options={[
            { value: "", label: "كل العمليات" },
            { value: "platform", label: "عمليات المنصة فقط" },
          ]}
        />
        {/* Built from what the log actually contains, so a filter never offers an action that has
            never happened — and never omits one that has. */}
        <FilterChips
          basePath="/platform/audit"
          param="action"
          active={action}
          keep={{ q, scope: sp.scope }}
          options={[
            { value: "", label: "كل الأنواع" },
            ...actions.slice(0, 8).map((a) => ({ value: a.action, label: a.action, hint: a.count })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          لا عمليات مطابقة.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                  <th>العملية</th><th>المكتب</th><th>المنفِّذ</th><th>التاريخ</th><th>التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2">
                      <span dir="ltr" className="font-medium">{r.action}</span>
                      {r.is_platform_action && <Badge tone="brand">منصة</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      {r.org_id ? (
                        <Link href={`/platform/tenants/${r.org_id}`} className="hover:text-brand hover:underline">
                          {r.org_name ?? "—"}
                        </Link>
                      ) : (
                        <span className="text-slate-400">على مستوى المنصة</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.actor_name ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2 text-left text-xs" dir="ltr">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-2">
                      {r.detail ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-brand">عرض</summary>
                          <pre dir="ltr" className="mt-1 max-w-80 overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {JSON.stringify(r.detail, null, 1)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-[11px] text-slate-400">محجوب — بيانات مكتب</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} q={q} basePath="/platform/audit" params={{ action, scope: sp.scope }} />
        </>
      )}
    </div>
  );
}
