import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { PrintButton } from "@/components/print-button";
import { UNIT_STATUS_AR } from "@/lib/labels";
import { halalasToSar } from "@/lib/money";
import { first } from "@/lib/rows";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The state of one property, unit by unit — the sheet an office sends when asked "what is the
// situation of the building".
//
// It carries no ownership block: who owns the property is not what this sheet answers, and a
// document travels further than the screen it was printed from.

type UnitRow = {
  id: string;
  unit_number: string;
  floor: string | null;
  area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  current_status: string;
};

export default async function PropertyUnitsReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const { data: property } = await supabase
    .from("property")
    .select("id, name, property_code, city, district, deed_number")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) notFound();

  const [{ data: unitData }, { data: contractData }, { data: org }] = await Promise.all([
    supabase
      .from("unit")
      .select("id, unit_number, floor, area_sqm, bedrooms, bathrooms, current_status")
      .eq("property_id", id)
      .is("deleted_at", null)
      .order("unit_number", { ascending: true }),
    supabase
      .from("contract")
      .select("unit_id, end_date, annual_rent_halalas, tenant:tenant_id(party:party_id(display_name))")
      .eq("property_id", id)
      .eq("status", "active")
      .is("deleted_at", null),
    supabase.from("organization").select("name, cr_number").eq("id", activeOrg).maybeSingle(),
  ]);

  const units = (unitData ?? []) as UnitRow[];
  const contractByUnit = new Map<string, { tenant: string | null; end: string; annual: number }>();
  for (const c of (contractData ?? []) as any[]) {
    contractByUnit.set(c.unit_id, {
      tenant: first(first(c.tenant)?.party)?.display_name ?? null,
      end: c.end_date,
      annual: Number(c.annual_rent_halalas),
    });
  }

  const rented = units.filter((u) => u.current_status === "rented").length;
  const vacant = units.filter((u) => u.current_status === "vacant").length;
  const totalRent = [...contractByUnit.values()].reduce((s, c) => s + c.annual, 0);
  const totalArea = units.reduce((s, u) => s + Number(u.area_sqm ?? 0), 0);

  const today = new Date().toISOString().slice(0, 10);
  const th = "px-3 py-2 text-right font-medium";
  const td = "px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <nav className="text-sm text-neutral-500">
          <Link href="/app/properties" className="hover:text-brand">العقارات</Link> /{" "}
          <Link href={`/app/properties/${property.id}`} className="hover:text-brand">{property.name}</Link> / تقرير الوحدات
        </nav>
        <PrintButton label="طباعة التقرير" />
      </div>

      <article className="print-sheet mx-auto rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <header className="mb-6 flex items-start justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
          <div>
            <h1 className="text-lg font-bold">{org?.name ?? "المنشأة"}</h1>
            {org?.cr_number && <p className="mt-1 text-xs text-neutral-500">س.ت: <span dir="ltr">{org.cr_number}</span></p>}
          </div>
          <div className="text-left">
            <h2 className="text-xl font-extrabold text-brand">تقرير وحدات العقار</h2>
            <p className="mt-1 text-xs text-neutral-500">بتاريخ <span dir="ltr">{today}</span></p>
          </div>
        </header>

        <dl className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-neutral-500">العقار</dt>
            <dd className="font-medium">{property.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">الموقع</dt>
            <dd className="font-medium">{[property.city, property.district].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">الكود</dt>
            <dd className="font-medium" dir="ltr">{property.property_code ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">رقم الصك</dt>
            <dd className="font-medium" dir="ltr">{property.deed_number ?? "—"}</dd>
          </div>
        </dl>

        {units.length === 0 ? (
          <p className="py-8 text-center text-neutral-500">لا توجد وحدات على هذا العقار.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-700">
              <tr>
                <th className={th}>الوحدة</th>
                <th className={th}>الدور</th>
                <th className={th}>المساحة (م²)</th>
                <th className={th}>غرف / دورات مياه</th>
                <th className={th}>الحالة</th>
                <th className={th}>المستأجر الحالي</th>
                <th className={th}>نهاية العقد</th>
                <th className={th}>الإيجار السنوي (ر.س)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {units.map((u) => {
                const c = contractByUnit.get(u.id);
                return (
                  <tr key={u.id}>
                    <td className={td + " font-medium"}>{u.unit_number}</td>
                    <td className={td}>{u.floor ?? "—"}</td>
                    <td className={td}>{u.area_sqm ?? "—"}</td>
                    <td className={td}>{u.bedrooms ?? "—"} / {u.bathrooms ?? "—"}</td>
                    <td className={td}>{UNIT_STATUS_AR[u.current_status] ?? u.current_status}</td>
                    <td className={td + " text-neutral-600 dark:text-neutral-300"}>{c?.tenant ?? "—"}</td>
                    <td className={td} dir="ltr">{c?.end ?? "—"}</td>
                    <td className={td + " tabular-nums"} dir="ltr">{c ? halalasToSar(c.annual) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-neutral-300 font-bold dark:border-neutral-600">
              <tr>
                <td className={td}>الإجمالي</td>
                <td className={td}>{units.length} وحدة</td>
                <td className={td}>{totalArea > 0 ? totalArea : "—"}</td>
                <td className={td}>—</td>
                <td className={td}>{rented} مؤجّرة · {vacant} شاغرة</td>
                <td className={td}>—</td>
                <td className={td}>—</td>
                <td className={td + " tabular-nums"} dir="ltr">{halalasToSar(totalRent)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        <p className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-700">
          المستأجر ونهاية العقد والإيجار من العقد <b>النشط</b> على الوحدة. والمساحة الإجمالية تجمع الوحدات المُدخَلة مساحتها فقط.
        </p>
      </article>
    </div>
  );
}
