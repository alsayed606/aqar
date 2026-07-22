import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { tafqitSar } from "@/lib/tafqit";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const first = (x: any) => (Array.isArray(x) ? x[0] : x);

export default async function RemittanceVoucher({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const { id, rid } = await params;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const { data: rem } = await supabase
    .from("owner_remittance")
    .select("id, remittance_no, amount_halalas, method, remitted_at, period_from, period_to, reference, notes, owner_id")
    .eq("id", rid)
    .eq("owner_id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!rem) notFound();

  const [{ data: owner }, { data: org }] = await Promise.all([
    supabase
      .from("owner")
      .select("id, is_self, iban, bank_name, party:party_id(display_name, national_id)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("organization").select("name, cr_number, vat_number").eq("id", activeOrg).maybeSingle(),
  ]);

  const party = first((owner as any)?.party);
  const ownerName = owner?.is_self ? "المنشأة (مالك ذاتي)" : party?.display_name;
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
          <Link href={`/app/owners/${id}`} className="hover:text-brand">{ownerName}</Link> /{" "}
          <span className="text-neutral-700 dark:text-neutral-300" dir="ltr">{rem.remittance_no ?? "—"}</span>
        </nav>
        <PrintButton label="طباعة السند" />
      </div>

      <article className="print-sheet mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <header className="mb-6 flex items-start justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
          <div>
            <h1 className="text-lg font-bold">{org?.name ?? "المنشأة"}</h1>
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              {org?.cr_number && <p>س.ت: <span dir="ltr">{org.cr_number}</span></p>}
              {org?.vat_number && <p>الرقم الضريبي: <span dir="ltr">{org.vat_number}</span></p>}
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
          <Row label="صُرف للمالك">
            {ownerName}
            {party?.national_id && (
              <span className="mr-2 text-xs text-neutral-500" dir="ltr">هوية/سجل: {party.national_id}</span>
            )}
          </Row>
          <Row label="مبلغاً وقدره">
            <span className="text-base">{halalasToSar(rem.amount_halalas)} ر.س</span>
          </Row>
          <Row label="فقط">
            <span className="font-normal">{tafqitSar(rem.amount_halalas)}</span>
          </Row>
          <Row label="طريقة الصرف">
            {PAYMENT_METHOD_AR[rem.method] ?? rem.method}
            {rem.reference && <span className="mr-2 text-xs text-neutral-500" dir="ltr">مرجع: {rem.reference}</span>}
          </Row>
          {owner?.iban && <Row label="الآيبان"><span dir="ltr">{owner.iban}</span></Row>}
          {(rem.period_from || rem.period_to) && (
            <Row label="عن الفترة">
              <span dir="ltr">{rem.period_from ?? "—"} → {rem.period_to ?? "—"}</span>
            </Row>
          )}
          {rem.notes && <Row label="ملاحظات">{rem.notes}</Row>}
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

        <p className="mt-6 text-center text-[10px] text-neutral-400">
          سند صرف يُثبت توريد المبلغ أعلاه للمالك.
        </p>
      </article>
    </div>
  );
}
