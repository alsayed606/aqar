import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { isoDaysAgo } from "@/lib/dates";
import { PAYMENT_METHOD_AR } from "@/lib/labels";

export const dynamic = "force-dynamic";

type OwnerLink = { owner_id: string; org_id: string; org_name: string; display_name: string; iban: string | null; bank_name: string | null };
type StmtRow = {
  property_id: string;
  property_name: string;
  collected_halalas: number;
  outstanding_halalas: number;
  fee_halalas: number;
  net_halalas: number;
};
type Property = { id: string; name: string; city: string | null };
type Remit = {
  id: string;
  remittance_no: string | null;
  amount_halalas: number;
  method: string;
  remitted_at: string;
  period_from: string | null;
  period_to: string | null;
};

export default async function OwnerPortalDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ ownerId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { ownerId } = await params;
  const sp = await searchParams;
  const from = sp.from || isoDaysAgo(90);
  const to = sp.to || isoDaysAgo(0);

  const supabase = await createClient();

  // Confirm this owner belongs to the caller (and get its office/name).
  const { data: linkData } = await supabase.rpc("my_owner_links");
  const link = ((linkData ?? []) as OwnerLink[]).find((l) => l.owner_id === ownerId);
  if (!link) redirect("/portal");

  const [{ data: stmt }, { data: propsData }, { data: remitData }] = await Promise.all([
    supabase.rpc("owner_portal_statement", { p_owner: ownerId, p_from: from, p_to: to }),
    supabase.rpc("owner_portal_properties", { p_owner: ownerId }),
    supabase.rpc("owner_portal_remittances", { p_owner: ownerId }),
  ]);

  const rows = (stmt ?? []) as StmtRow[];
  const properties = (propsData ?? []) as Property[];
  const remittances = (remitData ?? []) as Remit[];

  const tot = rows.reduce(
    (s, r) => ({
      collected: s.collected + Number(r.collected_halalas),
      fee: s.fee + Number(r.fee_halalas),
      net: s.net + Number(r.net_halalas),
      outstanding: s.outstanding + Number(r.outstanding_halalas),
    }),
    { collected: 0, fee: 0, net: 0, outstanding: 0 },
  );
  const remittedInPeriod = remittances
    .filter((r) => {
      const d = new Date(r.remitted_at).toISOString().slice(0, 10);
      return d >= from && d <= to;
    })
    .reduce((s, r) => s + Number(r.amount_halalas), 0);
  const due = tot.net - remittedInPeriod;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-neutral-500">{link.org_name}</p>
        <h1 className="text-xl font-bold">{link.display_name}</h1>
        {link.iban && <p className="mt-1 text-xs text-neutral-500" dir="ltr">IBAN: {link.iban}</p>}
      </header>

      {/* Period summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["المُحصَّل", tot.collected],
          ["الأتعاب", tot.fee],
          ["الصافي لك", tot.net],
          ["المتبقّي لك", due],
        ].map(([label, val]) => (
          <div key={label as string} className="rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-neutral-500">{label} (ر.س)</p>
            <p className="mt-1 text-lg font-bold">{halalasToSar(val as number)}</p>
          </div>
        ))}
      </div>

      {/* Statement */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">كشف الحساب</h2>
          <form method="get" className="flex items-end gap-2">
            <div>
              <label className="mb-0.5 block text-xs text-neutral-500" htmlFor="from">من</label>
              <input id="from" name="from" type="date" defaultValue={from} className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-neutral-700" />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-neutral-500" htmlFor="to">إلى</label>
              <input id="to" name="to" type="date" defaultValue={to} className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-neutral-700" />
            </div>
            <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">عرض</button>
          </form>
          <Link
            href={`/portal/${ownerId}/statement?from=${from}&to=${to}`}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-fg"
          >
            كشف قابل للطباعة ←
          </Link>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 text-right font-medium">العقار</th>
                <th className="px-4 py-2 text-right font-medium">المُحصَّل</th>
                <th className="px-4 py-2 text-right font-medium">الأتعاب</th>
                <th className="px-4 py-2 text-right font-medium">الصافي لك</th>
                <th className="px-4 py-2 text-right font-medium">المتبقّي على المستأجرين</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500">لا توجد حركة في هذه الفترة.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.property_id}>
                    <td className="px-4 py-2 font-medium">{r.property_name}</td>
                    <td className="px-4 py-2">{halalasToSar(r.collected_halalas)}</td>
                    <td className="px-4 py-2">{halalasToSar(r.fee_halalas)}</td>
                    <td className="px-4 py-2 font-medium text-emerald-700 dark:text-emerald-400">{halalasToSar(r.net_halalas)}</td>
                    <td className="px-4 py-2">{halalasToSar(r.outstanding_halalas)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Remittances */}
      <section>
        <h2 className="mb-3 text-base font-semibold">التوريدات إليك</h2>
        {remittances.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">لا توجد توريدات بعد.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2 text-right font-medium">رقم السند</th>
                  <th className="px-4 py-2 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-2 text-right font-medium">المبلغ (ر.س)</th>
                  <th className="px-4 py-2 text-right font-medium">الطريقة</th>
                  <th className="px-4 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {remittances.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-mono" dir="ltr">{r.remittance_no ?? "—"}</td>
                    <td className="px-4 py-2" dir="ltr">{new Date(r.remitted_at).toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 font-medium">{halalasToSar(r.amount_halalas)}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{PAYMENT_METHOD_AR[r.method] ?? r.method}</td>
                    <td className="px-4 py-2">
                      <Link href={`/portal/${ownerId}/remittance/${r.id}`} className="text-brand hover:underline">
                        سند الصرف ←
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Properties */}
      <section>
        <h2 className="mb-3 text-base font-semibold">عقاراتك ({properties.length})</h2>
        {properties.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">لا توجد عقارات مسجّلة.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {properties.map((p) => (
              <li key={p.id} className="rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <span className="font-medium">{p.name}</span>
                {p.city && <span className="mr-2 text-sm text-neutral-500">· {p.city}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-[11px] text-neutral-400">
        <Link href="/portal" className="hover:text-brand">← كل المكاتب</Link>
      </p>
    </div>
  );
}
