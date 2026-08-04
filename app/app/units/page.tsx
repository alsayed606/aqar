import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { UnitForm } from "@/components/unit-form";
import { FormDrawer } from "@/components/form-drawer";
import { UnitsGrid } from "@/components/units-grid";
import { UNIT_STATUS_AR } from "@/lib/labels";
import type { UnitCardData } from "@/components/unit-card";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; property?: string; status?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { error: flashError, property: propertyFilter, status: statusFilter } = await searchParams;
  const caps = await getCapabilities(activeOrg);
  const canData = caps.has("manage_data");

  const supabase = await createClient();
  // Active contracts supply the occupancy block (tenant + rent) for rented units.
  const [{ data: propData }, { data: unitData }, { data: contractData }] = await Promise.all([
    supabase.from("property").select("id, name").is("deleted_at", null).order("name"),
    // Deep links from a property 360 page narrow this list (§6.1); an unknown status is ignored
    // rather than trusted, so the param cannot reach the query as free text.
    (() => {
      let q = supabase
        .from("unit")
        .select("id, unit_number, floor, area_sqm, bedrooms, bathrooms, current_status, property:property_id(id, name, property_kind)")
        .is("deleted_at", null);
      if (propertyFilter) q = q.eq("property_id", propertyFilter);
      if (statusFilter && UNIT_STATUS_AR[statusFilter]) q = q.eq("current_status", statusFilter);
      return q.order("created_at", { ascending: false });
    })(),
    supabase
      .from("contract")
      .select("id, unit_id, annual_rent_halalas, tenant:tenant_id(party:party_id(display_name))")
      .eq("status", "active")
      .is("deleted_at", null),
  ]);

  const properties = (propData ?? []).map((p: any) => ({ id: p.id, label: p.name }));

  // Names the active deep-link filter for the chip and the empty state. Built from the loaded
  // property list rather than a second query, and from the same whitelist the query used.
  const filterLabel = [
    propertyFilter ? properties.find((x) => x.id === propertyFilter)?.label ?? "عقار محدَّد" : null,
    statusFilter && UNIT_STATUS_AR[statusFilter] ? UNIT_STATUS_AR[statusFilter] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const activeByUnit = new Map<string, any>();
  for (const contract of contractData ?? []) activeByUnit.set(contract.unit_id, contract);

  const units: UnitCardData[] = (unitData ?? []).map((u: any) => {
    const property = first(u.property);
    const contract = activeByUnit.get(u.id);
    return {
      id: u.id,
      unit_number: u.unit_number,
      current_status: u.current_status,
      floor: u.floor,
      area_sqm: u.area_sqm,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      property_id: property?.id ?? null,
      property_name: property?.name ?? null,
      property_kind: property?.property_kind ?? null,
      tenant_name: contract ? first(first(contract.tenant)?.party)?.display_name ?? null : null,
      annual_rent_halalas: contract ? Number(contract.annual_rent_halalas) : null,
      contract_id: contract?.id ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">الوحدات</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{units.length} وحدة</span>
          {canData && (
            <FormDrawer label="إضافة وحدة" title="إضافة وحدة">
              {properties.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  أضِف <Link href="/app/properties" className="underline">عقاراً</Link> أولاً لربط الوحدة به.
                </p>
              ) : (
                <UnitForm properties={properties} />
              )}
            </FormDrawer>
          )}
        </div>
      </div>

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

      {/* A filtered view that finds nothing must say the filter is why, and offer a way out. Saying
          "no units yet" when the office has units and simply none match is a dead end that reads
          like data loss (§6.2). */}
      {filterLabel && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-lg border border-brand bg-brand/10 px-3 py-1.5 text-brand">{filterLabel}</span>
          <Link href="/app/units" className="text-brand hover:underline">إزالة التصفية</Link>
        </div>
      )}

      {units.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          {filterLabel ? "لا توجد وحدات مطابقة لهذه التصفية." : "لا توجد وحدات بعد."}
        </p>
      ) : (
        <UnitsGrid units={units} canData={canData} />
      )}
    </div>
  );
}
