import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { UnitForm } from "@/components/unit-form";
import { changePropertyOwner } from "../actions";
import { PROPERTY_KIND_AR, UNIT_STATUS_AR, UNIT_STATUS_TONE } from "@/lib/labels";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const firstOf = (x: any) => (Array.isArray(x) ? x[0] : x);
const ownerLabel = (o: any) =>
  o?.is_self ? "المنشأة (مالك ذاتي)" : firstOf(o?.party)?.display_name ?? "مالك";

type UnitRow = {
  id: string;
  unit_number: string;
  floor: string | null;
  area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  current_status: string;
};

export default async function PropertyDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: flashError } = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const { data: property } = await supabase
    .from("property")
    .select(
      "id, name, property_kind, city, district, deed_number, owner_id, owner:owner_id(is_self, party:party_id(display_name))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!property) notFound();

  const [{ data: unitData }, { data: ownerData }] = await Promise.all([
    supabase
      .from("unit")
      .select("id, unit_number, floor, area_sqm, bedrooms, bathrooms, current_status")
      .eq("property_id", id)
      .is("deleted_at", null)
      .order("unit_number", { ascending: true }),
    supabase
      .from("owner")
      .select("id, is_self, party:party_id(display_name)")
      .is("deleted_at", null)
      .order("is_self", { ascending: false }),
  ]);

  const units = (unitData ?? []) as UnitRow[];
  const owners = ownerData ?? [];

  return (
    <div className="space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/properties" className="hover:text-brand">
          العقارات
        </Link>{" "}
        / <span className="text-neutral-700 dark:text-neutral-300">{property.name}</span>
      </nav>

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

      <header className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{property.name}</h1>
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {PROPERTY_KIND_AR[property.property_kind] ?? property.property_kind}
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {[property.city, property.district].filter(Boolean).join(" · ") || "—"}
        </p>
        {property.deed_number && (
          <p className="mt-1 text-xs text-neutral-400" dir="ltr">
            صك: {property.deed_number}
          </p>
        )}

        <form
          action={changePropertyOwner}
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800"
        >
          <input type="hidden" name="property_id" value={property.id} />
          <div>
            <label className="mb-1 block text-xs text-neutral-500" htmlFor="owner_id">
              المالك
            </label>
            <select
              id="owner_id"
              name="owner_id"
              defaultValue={property.owner_id}
              className="rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
            >
              {owners.map((o: any) => (
                <option key={o.id} value={o.id}>
                  {ownerLabel(o)}
                </option>
              ))}
            </select>
          </div>
          <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
            حفظ المالك
          </button>
          <span className="self-center text-xs text-neutral-400">
            الحالي: {ownerLabel((property as any).owner)}
          </span>
        </form>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-base font-semibold">إضافة وحدة</h2>
        <UnitForm propertyId={property.id} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">الوحدات</h2>
          <span className="text-sm text-neutral-500">{units.length} وحدة</span>
        </div>

        {units.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
            لا توجد وحدات بعد. أضِف أول وحدة من النموذج أعلاه.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2 text-right font-medium">رقم الوحدة</th>
                  <th className="px-4 py-2 text-right font-medium">الحالة</th>
                  <th className="px-4 py-2 text-right font-medium">الدور</th>
                  <th className="px-4 py-2 text-right font-medium">المساحة</th>
                  <th className="px-4 py-2 text-right font-medium">غرف</th>
                  <th className="px-4 py-2 text-right font-medium">دورات مياه</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2 font-medium">{u.unit_number}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          "rounded-full px-2.5 py-0.5 text-xs font-medium " +
                          (UNIT_STATUS_TONE[u.current_status] ?? "bg-neutral-100 text-neutral-700")
                        }
                      >
                        {UNIT_STATUS_AR[u.current_status] ?? u.current_status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{u.floor ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">
                      {u.area_sqm != null ? `${u.area_sqm} م²` : "—"}
                    </td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{u.bedrooms ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{u.bathrooms ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
