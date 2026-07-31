import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/subscription";
import { SUBSCRIPTION_STATUS_AR, SUBSCRIPTION_STATUS_TONE } from "@/lib/labels";
import { parseListParams, PAGE_SIZE } from "@/lib/list-params";
import { Badge } from "@/components/ui";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { UsageMeter } from "@/components/usage-meter";
import { SubscriptionDrawer } from "@/components/platform/subscription-drawer";
import { TenantActions } from "@/components/platform/tenant-actions";
import type { PlatformOrgRow } from "@/lib/platform";

export const dynamic = "force-dynamic";

// The operator gate lives in the layout (and in every RPC). Pages under /platform do not repeat it.
const STATUS_FILTERS = ["", "trialing", "active", "comped", "past_due", "suspended", "canceled"] as const;

export default async function PlatformTenants({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { q, page, from } = parseListParams(sp);
  const status = STATUS_FILTERS.includes((sp.status ?? "") as (typeof STATUS_FILTERS)[number]) ? sp.status ?? "" : "";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_list_orgs", {
    p_search: q || null,
    p_status: status || null,
    p_limit: PAGE_SIZE,
    p_offset: from,
  });
  const orgs = (data ?? []) as PlatformOrgRow[];
  const total = orgs[0]?.total_count ?? 0;
  const notMigrated = error?.message?.includes("platform_list_orgs");

  const filterHref = (value: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (value) params.set("status", value);
    const query = params.toString();
    return query ? `/platform/tenants?${query}` : "/platform/tenants";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">المكاتب</h1>
        <span className="text-sm text-slate-500">{total} مكتب</span>
      </div>

      {sp.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">حُدِّث الاشتراك.</p>
      )}
      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{sp.error}</p>
      )}

      <div className="space-y-3">
        <ListToolbar q={q} placeholder="بحث باسم المكتب…" keep={{ status }} />
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((value) => (
            <Link
              key={value || "all"}
              href={filterHref(value)}
              className={
                "rounded-full border px-3 py-1 text-xs transition-colors " +
                (status === value
                  ? "border-brand bg-brand text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800")
              }
            >
              {value ? SUBSCRIPTION_STATUS_AR[value] : "الكل"}
            </Link>
          ))}
        </div>
      </div>

      {notMigrated ? (
        <p className="rounded-2xl border border-dashed border-amber-400 p-8 text-center text-sm text-amber-700 dark:text-amber-300">
          طبّق الهجرة <span dir="ltr">0048</span> لتفعيل قائمة المكاتب.
        </p>
      ) : error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error.message}</p>
      ) : orgs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          {q || status ? "لا يوجد مكتب مطابق." : "لا توجد مكاتب بعد."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                  <th>المكتب</th>
                  <th>الخطة</th>
                  <th>الحالة</th>
                  <th>الاستهلاك</th>
                  <th>التجربة / التجديد</th>
                  <th>آخر دخول</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orgs.map((o) => (
                  <tr key={o.org_id} className="align-top">
                    <td className="px-3 py-3">
                      <span className="font-medium">{o.org_name}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400" dir="ltr">
                        منذ {fmtDate(o.created_at)}
                      </span>
                    </td>
                    <td className="px-3 py-3">{o.plan_name_ar ?? o.plan_code ?? "—"}</td>
                    <td className="px-3 py-3">
                      {o.status ? (
                        <Badge tone={SUBSCRIPTION_STATUS_TONE[o.status] ?? "neutral"}>
                          {SUBSCRIPTION_STATUS_AR[o.status] ?? o.status}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1.5">
                        <UsageMeter label="عقارات" used={o.properties} limit={o.max_properties} />
                        <UsageMeter label="وحدات" used={o.units} limit={o.max_units} />
                        <UsageMeter label="أعضاء" used={o.members} limit={o.max_members} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-left text-xs" dir="ltr">
                      <div>{fmtDate(o.trial_ends_at)}</div>
                      <div className="text-slate-400">{fmtDate(o.current_period_end)}</div>
                    </td>
                    <td className="px-3 py-3 text-left text-xs" dir="ltr">
                      <div>{fmtDate(o.last_sign_in_at)}</div>
                      {o.active_today > 0 && (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          {o.active_today} نشط اليوم
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <SubscriptionDrawer org={o} />
                        <Link href={`/platform/tenants/${o.org_id}`} className="text-xs text-slate-500 hover:text-brand hover:underline">
                          التفاصيل ←
                        </Link>
                        <TenantActions
                          orgId={o.org_id}
                          status={o.status}
                          planCode={o.plan_code}
                          back="/platform/tenants"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} q={q} basePath="/platform/tenants" params={{ status }} />
        </>
      )}
    </div>
  );
}
