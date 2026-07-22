import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { isoDaysAgo } from "@/lib/dates";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

type OwnerLink = { owner_id: string; org_name: string; display_name: string; iban: string | null; bank_name: string | null };
type StmtRow = { property_id: string; property_name: string; collected_halalas: number; outstanding_halalas: number; fee_halalas: number; net_halalas: number };
type Remit = { id: string; remittance_no: string | null; amount_halalas: number; method: string; remitted_at: string };

export default async function OwnerPortalStatementPrint({
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
  const { data: linkData } = await supabase.rpc("my_owner_links");
  const link = ((linkData ?? []) as OwnerLink[]).find((l) => l.owner_id === ownerId);
  if (!link) redirect("/portal");

  const [{ data: orgData }, { data: stmt }, { data: remitData }] = await Promise.all([
    supabase.rpc("owner_portal_org", { p_owner: ownerId }),
    supabase.rpc("owner_portal_statement", { p_owner: ownerId, p_from: from, p_to: to }),
    supabase.rpc("owner_portal_remittances", { p_owner: ownerId }),
  ]);
  const org = ((orgData ?? []) as { org_name: string; org_cr: string | null; org_vat: string | null }[])[0];
  const rows = (stmt ?? []) as StmtRow[];
  const remittances = ((remitData ?? []) as Remit[]).filter((r) => {
    const d = new Date(r.remitted_at).toISOString().slice(0, 10);
    return d >= from && d <= to;
  });

  const tot = rows.reduce(
    (s, r) => ({
      collected: s.collected + Number(r.collected_halalas),
      fee: s.fee + Number(r.fee_halalas),
      net: s.net + Number(r.net_halalas),
      outstanding: s.outstanding + Number(r.outstanding_halalas),
    }),
    { collected: 0, fee: 0, net: 0, outstanding: 0 },
  );
  const remitted = remittances.reduce((s, r) => s + Number(r.amount_halalas), 0);
  const due = tot.net - remitted;

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <nav className="text-sm text-neutral-500">
          <Link href={`/portal/${ownerId}`} className="hover:text-brand">بوابتي</Link> /{" "}
          <span className="text-neutral-700 dark:text-neutral-300">كشف حساب</span>
        </nav>
        <PrintButton label="طباعة الكشف" />
      </div>

      <article className="print-sheet mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <header className="mb-6 flex items-start justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
          <div>
            <h1 className="text-lg font-bold">{org?.org_name ?? link.org_name}</h1>
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              {org?.org_cr && <p>س.ت: <span dir="ltr">{org.org_cr}</span></p>}
              {org?.org_vat && <p>الرقم الضريبي: <span dir="ltr">{org.org_vat}</span></p>}
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-extrabold text-brand">كشف حساب مالك</h2>
            <p className="mt-1 text-xs text-neutral-500">Owner Statement</p>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <p><span className="text-neutral-500">المالك:</span> <span className="font-medium">{link.display_name}</span></p>
            {link.iban && <p><span className="text-neutral-500">الآيبان:</span> <span dir="ltr">{link.iban}</span></p>}
            {link.bank_name && <p><span className="text-neutral-500">البنك:</span> {link.bank_name}</p>}
          </div>
          <div className="space-y-1 sm:text-left">
            <p><span className="text-neutral-500">الفترة:</span> <span dir="ltr">{from} → {to}</span></p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-800/50">
              <tr>
                <th className="px-3 py-2 text-right font-medium">العقار</th>
                <th className="px-3 py-2 text-right font-medium">المُحصَّل</th>
                <th className="px-3 py-2 text-right font-medium">الأتعاب</th>
                <th className="px-3 py-2 text-right font-medium">الصافي لك</th>
                <th className="px-3 py-2 text-right font-medium">المتبقّي على المستأجرين</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-500">لا توجد حركة في هذه الفترة.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.property_id}>
                    <td className="px-3 py-2 font-medium">{r.property_name}</td>
                    <td className="px-3 py-2">{halalasToSar(r.collected_halalas)}</td>
                    <td className="px-3 py-2">{halalasToSar(r.fee_halalas)}</td>
                    <td className="px-3 py-2 font-medium">{halalasToSar(r.net_halalas)}</td>
                    <td className="px-3 py-2">{halalasToSar(r.outstanding_halalas)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-neutral-50 font-semibold dark:bg-neutral-800/50">
                <tr>
                  <td className="px-3 py-2">الإجمالي</td>
                  <td className="px-3 py-2">{halalasToSar(tot.collected)}</td>
                  <td className="px-3 py-2">{halalasToSar(tot.fee)}</td>
                  <td className="px-3 py-2">{halalasToSar(tot.net)}</td>
                  <td className="px-3 py-2">{halalasToSar(tot.outstanding)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {remittances.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">التوريدات خلال الفترة</h3>
            <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-800/50">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">رقم السند</th>
                    <th className="px-3 py-2 text-right font-medium">التاريخ</th>
                    <th className="px-3 py-2 text-right font-medium">الطريقة</th>
                    <th className="px-3 py-2 text-right font-medium">المبلغ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {remittances.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono" dir="ltr">{r.remittance_no ?? "—"}</td>
                      <td className="px-3 py-2" dir="ltr">{new Date(r.remitted_at).toISOString().slice(0, 10)}</td>
                      <td className="px-3 py-2">{PAYMENT_METHOD_AR[r.method] ?? r.method}</td>
                      <td className="px-3 py-2 font-medium">{halalasToSar(r.amount_halalas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <dl className="min-w-[260px] space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-neutral-500">صافي الفترة</dt><dd>{halalasToSar(tot.net)} ر.س</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">المورّد خلال الفترة</dt><dd>{halalasToSar(remitted)} ر.س</dd></div>
            <div className="flex justify-between border-t border-neutral-200 pt-1 text-base font-bold dark:border-neutral-700">
              <dt>المتبقّي لك</dt><dd>{halalasToSar(due)} ر.س</dd>
            </div>
          </dl>
        </div>

        <p className="mt-6 border-t border-neutral-100 pt-4 text-center text-[10px] text-neutral-400 dark:border-neutral-800">
          كشف حساب استرشادي مبني على الدفعات المُحصَّلة واتفاقية الأتعاب خلال الفترة المذكورة.
        </p>
      </article>
    </div>
  );
}
