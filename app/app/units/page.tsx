import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { UnitForm } from "@/components/unit-form";
import { UNIT_STATUS_AR, UNIT_STATUS_TONE } from "@/lib/labels";
import { FilterableCards } from "@/components/filterable-list";
import { UnitEditDrawer } from "@/components/unit-edit-drawer";
import { FormDrawer } from "@/components/form-drawer";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { error: flashError } = await searchParams;
  const caps = await getCapabilities(activeOrg);
  const canData = caps.has("manage_data");

  const supabase = await createClient();
  const [{ data: propData }, { data: unitData }] = await Promise.all([
    supabase.from("property").select("id, name").is("deleted_at", null).order("name"),
    supabase
      .from("unit")
      .select("id, unit_number, floor, area_sqm, bedrooms, bathrooms, current_status, property:property_id(id, name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const properties = (propData ?? []).map((p: any) => ({ id: p.id, label: p.name }));
  const units = (unitData ?? []) as any[];

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

      {units.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد وحدات بعد.
        </p>
      ) : (
        <FilterableCards
          placeholder="تصفية الوحدات… (رقم الوحدة أو العقار)"
          items={units.map((u) => {
            const prop = first(u.property);
            return {
              id: u.id,
              search: [u.unit_number, prop?.name, UNIT_STATUS_AR[u.current_status]].filter(Boolean).join(" "),
              node: (
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">وحدة {u.unit_number}</span>
                    <span className="mr-2 text-sm text-neutral-500">
                      <Link href={`/app/properties/${prop?.id}`} className="hover:text-brand">
                        {prop?.name ?? "—"}
                      </Link>
                    </span>
                  </div>
                  <span className={"rounded-full px-2.5 py-0.5 text-xs font-medium " + (UNIT_STATUS_TONE[u.current_status] ?? "bg-neutral-100 text-neutral-700")}>
                    {UNIT_STATUS_AR[u.current_status] ?? u.current_status}
                  </span>
                </div>

                {canData && (
                  <div className="mt-2">
                    <UnitEditDrawer
                      unit={{
                        id: u.id,
                        unit_number: u.unit_number,
                        current_status: u.current_status,
                        floor: u.floor,
                        area_sqm: u.area_sqm,
                        bedrooms: u.bedrooms,
                        bathrooms: u.bathrooms,
                      }}
                    />
                  </div>
                )}
              </div>
              ),
            };
          })}
        />
      )}
    </div>
  );
}
