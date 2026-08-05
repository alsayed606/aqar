import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { PropertyForm } from "@/components/property-form";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteProperty } from "./actions";
import { PROPERTY_KIND_AR } from "@/lib/labels";
import { parseListParams, likePattern } from "@/lib/list-params";
import { LIST_SPECS, resolveSort, applySort } from "@/lib/list-specs";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FilterableTable } from "@/components/filterable-list";
import { FormDrawer } from "@/components/form-drawer";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
type PropertyRow = {
  id: string;
  name: string;
  property_kind: string;
  property_code: string | null;
  holding_type: string;
  city: string | null;
};
const HOLDING_AR: Record<string, string> = { owned: "مملوك", managed: "إدارة أملاك", investment: "استثمار" };

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; error?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to, sort } = parseListParams(await searchParams);
  const sortOption = resolveSort(LIST_SPECS.properties, sort);
  const { error: flashError } = await searchParams;
  const caps = await getCapabilities(activeOrg);
  const canData = caps.has("manage_data");

  const supabase = await createClient();
  let propQuery = supabase
    .from("property")
    .select("id, name, property_kind, property_code, holding_type, city", { count: "exact" })
    .is("deleted_at", null);
  if (q) propQuery = propQuery.ilike("name", likePattern(q));

  const count0 = () => supabase.from("unit").select("id", { count: "exact", head: true }).is("deleted_at", null);
  const [{ data, error, count }, { data: ownerData }, totalU, vacantU, rentedU, incompleteU] = await Promise.all([
    applySort(propQuery, sortOption).range(from, to),
    supabase.from("owner").select("id, is_self, party:party_id(display_name, national_id)").is("deleted_at", null).order("is_self", { ascending: false }),
    count0(),
    count0().eq("current_status", "vacant"),
    count0().eq("current_status", "rented"),
    count0().is("area_sqm", null),
  ]);

  const properties = (data ?? []) as PropertyRow[];
  const total = count ?? 0;
  const owners = (ownerData ?? []).map((o: any) => {
    const p = Array.isArray(o.party) ? o.party[0] : o.party;
    return { id: o.id, label: o.is_self ? "المنشأة (مالك ذاتي)" : p?.display_name ?? "مالك", national_id: p?.national_id ?? null };
  });

  // Per-property unit totals for the visible page.
  const ids = properties.map((p) => p.id);
  const unitMap = new Map<string, { total: number; vacant: number }>();
  if (ids.length) {
    const { data: us } = await supabase.from("unit").select("property_id, current_status").is("deleted_at", null).in("property_id", ids);
    for (const u of us ?? []) {
      const m = unitMap.get(u.property_id) ?? { total: 0, vacant: 0 };
      m.total++;
      if (u.current_status === "vacant") m.vacant++;
      unitMap.set(u.property_id, m);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">العقارات</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{total} عقار</span>
          {canData && (
            <FormDrawer label="إضافة عقار" title="إضافة عقار">
              <PropertyForm owners={owners} />
            </FormDrawer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="إجمالي الوحدات" value={totalU.count ?? 0} />
        <Kpi label="شاغرة" value={vacantU.count ?? 0} />
        <Kpi label="مؤجرة" value={rentedU.count ?? 0} />
        <Kpi label="غير مكتملة" value={incompleteU.count ?? 0} />
      </div>

      {flashError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>}

      <ListToolbar q={q} placeholder="بحث باسم العقار…" resource="properties" sort={sortOption.key} />

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">تعذّر تحميل العقارات: {error.message}</p>
      ) : properties.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا توجد عقارات بعد."}
        </p>
      ) : (
        <>
          <FilterableTable
            placeholder="تصفية سريعة في هذه الصفحة…"
            headers={
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                <th>العقار</th>
                <th>التصنيف</th>
                <th>الكود</th>
                <th>العلاقة</th>
                <th>الوحدات</th>
                <th>شاغرة</th>
                <th></th>
              </tr>
            }
            rows={properties.map((p) => {
              const u = unitMap.get(p.id) ?? { total: 0, vacant: 0 };
              return {
                id: p.id,
                search: [p.name, p.city, p.property_code, PROPERTY_KIND_AR[p.property_kind] ?? p.property_kind, HOLDING_AR[p.holding_type] ?? p.holding_type]
                  .filter(Boolean)
                  .join(" "),
                cells: (
                  <>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/app/properties/${p.id}`} className="hover:text-brand hover:underline">{p.name}</Link>
                      {p.city && <span className="mr-2 text-xs text-slate-400">{p.city}</span>}
                    </td>
                    <td className="px-3 py-2">{PROPERTY_KIND_AR[p.property_kind] ?? p.property_kind}</td>
                    <td dir="ltr" className="px-3 py-2 text-right text-slate-500">{p.property_code ?? "—"}</td>
                    <td className="px-3 py-2">{HOLDING_AR[p.holding_type] ?? p.holding_type}</td>
                    <td className="px-3 py-2">{u.total}</td>
                    <td className="px-3 py-2">{u.vacant}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link href={`/app/properties/${p.id}`} className="text-xs text-brand hover:underline">عرض/تعديل</Link>
                        {/* Offered only while the property is empty. The 0067 guard refuses the
                            rest anyway, and a delete link that always fails is not a safeguard —
                            it is a promise the row cannot keep. */}
                        {canData && u.total === 0 && (
                          <form action={deleteProperty}>
                            <input type="hidden" name="property_id" value={p.id} />
                            <ConfirmButton message={`حذف العقار «${p.name}»؟ يبقى سجلّه محفوظاً.`} className="text-xs text-red-600 hover:underline">
                              حذف
                            </ConfirmButton>
                          </form>
                        )}
                        {canData && u.total > 0 && (
                          <span className="text-xs text-slate-400" title="احذف وحداته أوّلاً">
                            لا يُحذف
                          </span>
                        )}
                      </div>
                    </td>
                  </>
                ),
              };
            })}
          />
          <Pagination page={page} total={total} q={q} basePath="/app/properties" params={{ sort: sortOption.key }} />
        </>
      )}
    </div>
  );
}
