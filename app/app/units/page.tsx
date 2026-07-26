import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { UnitForm } from "@/components/unit-form";
import { updateUnit } from "../properties/actions";
import { UNIT_STATUS_AR, UNIT_STATUS_TONE } from "@/lib/labels";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const firstOf = (x: any) => (Array.isArray(x) ? x[0] : x);

const fieldCls = "w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700";

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الوحدات</h1>
        <span className="text-sm text-neutral-500">{units.length} وحدة</span>
      </div>

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

      {canData && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-4 text-base font-semibold">إضافة وحدة</h2>
          {properties.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              أضِف{" "}
              <Link href="/app/properties" className="underline">
                عقاراً
              </Link>{" "}
              أولاً لربط الوحدة به.
            </p>
          ) : (
            <UnitForm properties={properties} />
          )}
        </section>
      )}

      {units.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد وحدات بعد.
        </p>
      ) : (
        <div className="space-y-2">
          {units.map((u) => {
            const prop = firstOf(u.property);
            return (
              <div key={u.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
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
                  <details className="mt-3">
                    <summary className="cursor-pointer select-none text-sm text-brand">تعديل</summary>
                    <form action={updateUnit} className="mt-3 grid gap-2 sm:grid-cols-3">
                      <input type="hidden" name="unit_id" value={u.id} />
                      <input type="hidden" name="back" value="/app/units" />
                      <input name="unit_number" defaultValue={u.unit_number} placeholder="رقم الوحدة" className={fieldCls} required />
                      <select name="current_status" defaultValue={u.current_status} className={fieldCls}>
                        {Object.entries(UNIT_STATUS_AR).map(([v, label]) => (
                          <option key={v} value={v}>{label}</option>
                        ))}
                      </select>
                      <input name="floor" defaultValue={u.floor ?? ""} placeholder="الدور" className={fieldCls} />
                      <input name="area_sqm" defaultValue={u.area_sqm ?? ""} placeholder="المساحة م²" inputMode="decimal" className={fieldCls} />
                      <input name="bedrooms" defaultValue={u.bedrooms ?? ""} placeholder="غرف" inputMode="numeric" className={fieldCls} />
                      <input name="bathrooms" defaultValue={u.bathrooms ?? ""} placeholder="دورات مياه" inputMode="numeric" className={fieldCls} />
                      <div className="sm:col-span-3">
                        <button className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg">
                          حفظ التعديل
                        </button>
                      </div>
                    </form>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
