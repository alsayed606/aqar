import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { TenantForm } from "@/components/tenant-form";
import { TenantPortalInvite } from "@/components/tenant-portal-invite";
import { parseListParams, likePattern } from "@/lib/list-params";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FilterableTable } from "@/components/filterable-list";
import { FormDrawer } from "@/components/form-drawer";

export const dynamic = "force-dynamic";

type TenantRow = {
  id: string;
  party:
    | { display_name: string; national_id: string | null; phone_e164: string | null }
    | { display_name: string; national_id: string | null; phone_e164: string | null }[]
    | null;
};

function party(t: TenantRow) {
  return Array.isArray(t.party) ? t.party[0] : t.party;
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to } = parseListParams(await searchParams);

  const supabase = await createClient();
  let query = supabase
    .from("tenant")
    .select("id, party:party_id!inner(display_name, national_id, phone_e164)", { count: "exact" })
    .is("deleted_at", null);
  if (q) query = query.ilike("party.display_name", likePattern(q));
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);

  const tenants = (data ?? []) as TenantRow[];
  const total = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">المستأجرون</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{total} مستأجر</span>
          <FormDrawer label="إضافة مستأجر" title="إضافة مستأجر">
            <TenantForm />
          </FormDrawer>
        </div>
      </div>

      <ListToolbar q={q} placeholder="بحث باسم المستأجر…" />

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل المستأجرين: {error.message}
        </p>
      ) : tenants.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا يوجد مستأجرون بعد. أضِف أول مستأجر من النموذج أعلاه."}
        </p>
      ) : (
        <>
          <FilterableTable
            placeholder="تصفية سريعة في هذه الصفحة…"
            headers={
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                <th>الاسم</th>
                <th>رقم الهوية / الإقامة</th>
                <th>الجوال</th>
                <th>بوابة المستأجر</th>
              </tr>
            }
            rows={tenants.map((t) => {
              const p = party(t);
              return {
                id: t.id,
                search: [p?.display_name, p?.national_id, p?.phone_e164].filter(Boolean).join(" "),
                cells: (
                  <>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/app/tenants/${t.id}`} className="hover:text-brand hover:underline">
                        {p?.display_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300" dir="ltr">{p?.national_id ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300" dir="ltr">{p?.phone_e164 ?? "—"}</td>
                    <td className="px-4 py-2">
                      <TenantPortalInvite tenantId={t.id} />
                    </td>
                  </>
                ),
              };
            })}
          />
          <Pagination page={page} total={total} q={q} basePath="/app/tenants" />
        </>
      )}
    </div>
  );
}
