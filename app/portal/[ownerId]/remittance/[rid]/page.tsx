import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { tafqitSar } from "@/lib/tafqit";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

type OwnerLink = { owner_id: string; org_name: string; display_name: string; iban: string | null };
type Remit = {
  id: string;
  remittance_no: string | null;
  amount_halalas: number;
  method: string;
  remitted_at: string;
  period_from: string | null;
  period_to: string | null;
};

export default async function OwnerRemittanceVoucherPrint({
  params,
}: {
  params: Promise<{ ownerId: string; rid: string }>;
}) {
  const { ownerId, rid } = await params;
  const supabase = await createClient();

  const { data: linkData } = await supabase.rpc("my_owner_links");
  const link = ((linkData ?? []) as OwnerLink[]).find((l) => l.owner_id === ownerId);
  if (!link) redirect("/portal");

  const [{ data: orgData }, { data: remitData }] = await Promise.all([
    supabase.rpc("owner_portal_org", { p_owner: ownerId }),
    supabase.rpc("owner_portal_remittances", { p_owner: ownerId }),
  ]);
  const org = ((orgData ?? []) as { org_name: string; org_cr: string | null; org_vat: string | null }[])[0];
  const rem = ((remitData ?? []) as Remit[]).find((r) => r.id === rid);
  if (!rem) notFound();
  const remittedDate = new Date(rem.remitted_at).toISOString().slice(0, 10);

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex gap-2 border-b border-dashed border-neutral-200 py-2 dark:border-neutral-700">
      <span className="w-32 shrink-0 text-sm text-neutral-500">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <nav className="text-sm text-neutral-500">
          <Link href={`/portal/${ownerId}`} className="hover:text-brand">بوابتي</Link> /{" "}
          <span className="text-neutral-700 dark:text-neutral-300" dir="ltr">{rem.remittance_no ?? "—"}</span>
        </nav>
        <PrintButton label="طباعة السند" />
      </div>

      <article className="print-sheet mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <header className="mb-6 flex items-start justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
          <div>
            <h1 className="text-lg font-bold">{org?.org_name ?? link.org_name}</h1>
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              {org?.org_cr && <p>س.ت: <span dir="ltr">{org.org_cr}</span></p>}
              {org?.org_vat && <p>الرقم الضريبي: <span dir="ltr">{org.org_vat}</span></p>}
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-extrabold text-brand">سند صرف</h2>
            <p className="mt-1 text-xs text-neutral-500">Remittance Voucher</p>
          </div>
        </header>

        <div className="mb-4 flex justify-between text-sm">
          <span>رقم السند: <span className="font-mono font-bold" dir="ltr">{rem.remittance_no ?? "—"}</span></span>
          <span>التاريخ: <span dir="ltr">{remittedDate}</span></span>
        </div>

        <div className="space-y-1">
          <Row label="صُرف للمالك">{link.display_name}</Row>
          <Row label="مبلغاً وقدره"><span className="text-base">{halalasToSar(rem.amount_halalas)} ر.س</span></Row>
          <Row label="فقط"><span className="font-normal">{tafqitSar(rem.amount_halalas)}</span></Row>
          <Row label="طريقة الصرف">{PAYMENT_METHOD_AR[rem.method] ?? rem.method}</Row>
          {link.iban && <Row label="الآيبان"><span dir="ltr">{link.iban}</span></Row>}
          {(rem.period_from || rem.period_to) && (
            <Row label="عن الفترة"><span dir="ltr">{rem.period_from ?? "—"} → {rem.period_to ?? "—"}</span></Row>
          )}
        </div>

        <footer className="mt-10 flex justify-between text-sm">
          <div className="text-center">
            <p className="text-neutral-500">المستلم (المالك)</p>
            <div className="mt-8 w-40 border-t border-neutral-300 dark:border-neutral-600" />
          </div>
          <div className="text-center">
            <p className="text-neutral-500">المُصرِّف (الختم والتوقيع)</p>
            <div className="mt-8 w-40 border-t border-neutral-300 dark:border-neutral-600" />
          </div>
        </footer>

        <p className="mt-6 text-center text-[10px] text-neutral-400">سند صرف يُثبت توريد المبلغ أعلاه للمالك.</p>
      </article>
    </div>
  );
}
