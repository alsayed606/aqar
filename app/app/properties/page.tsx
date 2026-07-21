import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { PropertyForm } from "@/components/property-form";
import { PROPERTY_KIND_AR } from "@/lib/labels";

export const dynamic = "force-dynamic";

type PropertyRow = {
  id: string;
  name: string;
  property_kind: string;
  city: string | null;
  district: string | null;
  deed_number: string | null;
};

export default async function PropertiesPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const [{ data, error }, { data: ownerData }] = await Promise.all([
    supabase
      .from("property")
      .select("id, name, property_kind, city, district, deed_number")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("owner")
      .select("id, is_self, party:party_id(display_name)")
      .is("deleted_at", null)
      .order("is_self", { ascending: false }),
  ]);

  const properties = (data ?? []) as PropertyRow[];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const owners = (ownerData ?? []).map((o: any) => ({
    id: o.id,
    label: o.is_self
      ? "المنشأة (مالك ذاتي)"
      : (Array.isArray(o.party) ? o.party[0]?.display_name : o.party?.display_name) ?? "مالك",
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">العقارات</h1>
        <span className="text-sm text-neutral-500">{properties.length} عقار</span>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-base font-semibold">إضافة عقار</h2>
        <PropertyForm owners={owners} />
      </section>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل العقارات: {error.message}
        </p>
      ) : properties.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد عقارات بعد. أضِف أول عقار من النموذج أعلاه.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {properties.map((p) => (
            <li key={p.id}>
              <Link
                href={`/app/properties/${p.id}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-brand dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{p.name}</p>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                    {PROPERTY_KIND_AR[p.property_kind] ?? p.property_kind}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-500">
                  {[p.city, p.district].filter(Boolean).join(" · ") || "—"}
                </p>
                {p.deed_number && (
                  <p className="mt-1 text-xs text-neutral-400" dir="ltr">
                    صك: {p.deed_number}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
