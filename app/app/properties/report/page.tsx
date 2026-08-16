import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { PrintButton } from "@/components/print-button";
import { halalasToSar } from "@/lib/money";
import { occupancyLabel } from "@/lib/occupancy";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The portfolio on one sheet.
//
// Deliberately NOT a printed copy of the properties table. A landlord already knows the names of
// their buildings; what they ask for is occupancy and what the portfolio is contracted to collect.
// So each row answers those, and the last row totals them.
//
// No tenant is named here. This sheet travels further than a single owner's statement does.

// A report is read as a whole or not at all, so it is not paginated — but an unbounded read is not
// a report either. An office beyond this many properties needs the Excel export, not paper.
const MAX_PROPERTIES = 500;

type Row = {
  id: string;
  name: string;
  city: string | null;
  units: number;
  rented: number;
  vacant: number;
  annualRentHalalas: number;
};

export default async function PortfolioReport() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const [{ data: propData }, { data: unitData }, { data: contractData }, { data: org }] = await Promise.all([
    supabase
      .from("property")
      .select("id, name, city")
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(MAX_PROPERTIES),
    supabase.from("unit").select("property_id, current_status").is("deleted_at", null),
    // Only active contracts: a draft is not money, and an ended one is not this year's.
    supabase
      .from("contract")
      .select("property_id, annual_rent_halalas")
      .eq("status", "active")
      .is("deleted_at", null),
    supabase.from("organization").select("name, cr_number").eq("id", activeOrg).maybeSingle(),
  ]);

  const rows: Row[] = ((propData ?? []) as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    city: p.city,
    units: 0,
    rented: 0,
    vacant: 0,
    annualRentHalalas: 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const u of (unitData ?? []) as any[]) {
    const row = byId.get(u.property_id);
    if (!row) continue;
    row.units += 1;
    if (u.current_status === "rented") row.rented += 1;
    else if (u.current_status === "vacant") row.vacant += 1;
  }
  for (const c of (contractData ?? []) as any[]) {
    const row = byId.get(c.property_id);
    if (row) row.annualRentHalalas += Number(c.annual_rent_halalas);
  }

  const sum = (pick: (r: Row) => number) => rows.reduce((total, r) => total + pick(r), 0);
  const totalUnits = sum((r) => r.units);
  const totalRented = sum((r) => r.rented);
  const totalVacant = sum((r) => r.vacant);
  const totalRent = sum((r) => r.annualRentHalalas);

  const today = new Date().toISOString().slice(0, 10);
  const th = "px-3 py-2 text-right font-medium";
  const td = "px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <nav className="text-sm text-neutral-500">
          <Link href="/app/properties" className="hover:text-brand">العقارات</Link> / تقرير المحفظة
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
            <h2 className="text-xl font-extrabold text-brand">تقرير العقارات</h2>
            <p className="mt-1 text-xs text-neutral-500">بتاريخ <span dir="ltr">{today}</span></p>
          </div>
        </header>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-neutral-500">لا توجد عقارات.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-700">
              <tr>
                <th className={th}>العقار</th>
                <th className={th}>المدينة</th>
                <th className={th}>الوحدات</th>
                <th className={th}>مؤجّرة</th>
                <th className={th}>شاغرة</th>
                <th className={th}>الإشغال</th>
                <th className={th}>الإيجار التعاقدي السنوي (ر.س)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={td + " font-medium"}>{r.name}</td>
                  <td className={td + " text-neutral-600 dark:text-neutral-300"}>{r.city ?? "—"}</td>
                  <td className={td}>{r.units}</td>
                  <td className={td}>{r.rented}</td>
                  <td className={td}>{r.vacant}</td>
                  <td className={td}>{occupancyLabel(r.rented, r.units)}</td>
                  <td className={td + " tabular-nums"} dir="ltr">{halalasToSar(r.annualRentHalalas)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-neutral-300 font-bold dark:border-neutral-600">
              <tr>
                <td className={td}>الإجمالي</td>
                <td className={td}>{rows.length} عقار</td>
                <td className={td}>{totalUnits}</td>
                <td className={td}>{totalRented}</td>
                <td className={td}>{totalVacant}</td>
                <td className={td}>{occupancyLabel(totalRented, totalUnits)}</td>
                <td className={td + " tabular-nums"} dir="ltr">{halalasToSar(totalRent)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        <p className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-700">
          الإيجار التعاقدي السنوي هو مجموع العقود <b>النشطة</b> على كل عقار — لا المحصّل فعلاً.
          {rows.length >= MAX_PROPERTIES && <> ويعرض التقرير أول {MAX_PROPERTIES} عقار؛ للبقية استخدم تصدير Excel.</>}
        </p>
      </article>
    </div>
  );
}
