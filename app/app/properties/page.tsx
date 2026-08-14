import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { PropertyForm } from "@/components/property-form";
import { parseListParams, likePattern } from "@/lib/list-params";
import { LIST_SPECS, resolveSort, applySort } from "@/lib/list-specs";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { PropertiesGrid } from "@/components/properties-grid";
import type { PropertyCardData } from "@/components/property-card";
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
  district: string | null;
  deed_number: string | null;
  owner_id: string | null;
};

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
    .select("id, name, property_kind, property_code, holding_type, city, district, deed_number, owner_id", { count: "exact" })
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

  // Per-property figures for the visible page: occupancy, how much of the data was left empty, and
  // what the property is contracted to collect. Two reads for the page, not two per card.
  const ids = properties.map((p) => p.id);
  const unitMap = new Map<string, { total: number; rented: number; vacant: number; missingArea: number }>();
  const rentMap = new Map<string, number>();
  if (ids.length) {
    const [{ data: us }, { data: cs }] = await Promise.all([
      supabase.from("unit").select("property_id, current_status, area_sqm").is("deleted_at", null).in("property_id", ids),
      // Active only: a draft is not money, and an ended contract is not this year's.
      supabase
        .from("contract")
        .select("property_id, annual_rent_halalas")
        .eq("status", "active")
        .is("deleted_at", null)
        .in("property_id", ids),
    ]);
    for (const u of us ?? []) {
      const m = unitMap.get(u.property_id) ?? { total: 0, rented: 0, vacant: 0, missingArea: 0 };
      m.total++;
      if (u.current_status === "vacant") m.vacant++;
      else if (u.current_status === "rented") m.rented++;
      if (u.area_sqm == null) m.missingArea++;
      unitMap.set(u.property_id, m);
    }
    for (const c of (cs ?? []) as any[]) {
      rentMap.set(c.property_id, (rentMap.get(c.property_id) ?? 0) + Number(c.annual_rent_halalas));
    }
  }

  const cards: PropertyCardData[] = properties.map((p) => {
    const u = unitMap.get(p.id) ?? { total: 0, rented: 0, vacant: 0, missingArea: 0 };
    return {
      id: p.id,
      name: p.name,
      property_kind: p.property_kind,
      property_code: p.property_code,
      holding_type: p.holding_type,
      city: p.city,
      district: p.district,
      // The number itself is not shown: a list is where you notice a deed is missing, not where you
      // read one. Same for the owner link.
      has_deed: !!p.deed_number,
      has_owner: !!p.owner_id,
      units: u.total,
      rented: u.rented,
      vacant: u.vacant,
      missingArea: u.missingArea,
      annualRentHalalas: rentMap.get(p.id) ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">العقارات</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{total} عقار</span>
          {/* A document, not a download: the export beside it answers the other question. */}
          <Link
            href="/app/properties/report"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            تقرير العقارات
          </Link>
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
        {/* Named for what it counts. "Incomplete" invited the reader to guess which field. */}
        <Kpi label="بلا مساحة" value={incompleteU.count ?? 0} />
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
          <PropertiesGrid properties={cards} canData={canData} />
          <Pagination page={page} total={total} q={q} basePath="/app/properties" params={{ sort: sortOption.key }} />
        </>
      )}
    </div>
  );
}
