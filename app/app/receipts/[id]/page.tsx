import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { tafqitSar } from "@/lib/tafqit";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";
import { first } from "@/lib/rows";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Alloc = {
  amount_halalas: number;
  charge: any;
};

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const { data: payment } = await supabase
    .from("payment")
    .select(
      "id, receipt_no, amount_halalas, method, received_at, reference, notes, org_id, party:party_id(display_name, national_id, iqama_id, phone_e164)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!payment) notFound();

  const [{ data: org }, { data: allocData }] = await Promise.all([
    supabase.from("organization").select("name, cr_number, vat_number").eq("id", payment.org_id).maybeSingle(),
    supabase
      .from("payment_allocation")
      .select(
        "amount_halalas, charge:charge_id(description, due_date, contract:contract_id(contract_number, unit:unit_id(unit_number, property:property_id(name))))",
      )
      .eq("payment_id", id),
  ]);

  const party = first((payment as any).party);
  const allocs = (allocData ?? []) as Alloc[];
  const allocated = allocs.reduce((s, a) => s + Number(a.amount_halalas), 0);
  const credit = Number(payment.amount_halalas) - allocated;
  const receivedDate = new Date(payment.received_at).toISOString().slice(0, 10);

  const describe = (a: Alloc) => {
    const ch = a.charge;
    const contract = first(ch?.contract);
    const unit = first(contract?.unit);
    const prop = first(unit?.property);
    const bits = [
      ch?.description,
      contract?.contract_number ? `عقد ${contract.contract_number}` : null,
      unit?.unit_number ? `وحدة ${unit.unit_number}` : null,
      prop?.name,
    ].filter(Boolean);
    return bits.join(" — ");
  };

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
          <Link href="/app/receipts" className="hover:text-brand">السندات</Link> /{" "}
          <span className="text-neutral-700 dark:text-neutral-300" dir="ltr">{payment.receipt_no ?? "—"}</span>
        </nav>
        <PrintButton label="طباعة السند" />
      </div>

      <article className="print-sheet mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <header className="mb-6 flex items-start justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
          <div>
            <h1 className="text-lg font-bold">{org?.name ?? "المنشأة"}</h1>
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              {org?.cr_number && <p>س.ت: <span dir="ltr">{org.cr_number}</span></p>}
              {org?.vat_number && <p>الرقم الضريبي: <span dir="ltr">{org.vat_number}</span></p>}
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-extrabold text-brand">سند قبض</h2>
            <p className="mt-1 text-xs text-neutral-500">Receipt Voucher</p>
          </div>
        </header>

        {/* Number + date */}
        <div className="mb-4 flex justify-between text-sm">
          <span>رقم السند: <span className="font-mono font-bold" dir="ltr">{payment.receipt_no ?? "—"}</span></span>
          <span>التاريخ: <span dir="ltr">{receivedDate}</span></span>
        </div>

        {/* Body */}
        <div className="space-y-1">
          <Row label="استلمنا من">
            {party?.display_name ?? "—"}
            {(party?.national_id || party?.iqama_id) && (
              <span className="mr-2 text-xs text-neutral-500" dir="ltr">
                هوية/إقامة: {party.national_id || party.iqama_id}
              </span>
            )}
          </Row>
          <Row label="مبلغاً وقدره">
            <span className="text-base">{halalasToSar(payment.amount_halalas)} ر.س</span>
          </Row>
          <Row label="فقط">
            <span className="font-normal">{tafqitSar(payment.amount_halalas)}</span>
          </Row>
          <Row label="طريقة الدفع">
            {PAYMENT_METHOD_AR[payment.method] ?? payment.method}
            {payment.reference && (
              <span className="mr-2 text-xs text-neutral-500" dir="ltr">مرجع: {payment.reference}</span>
            )}
          </Row>
          <Row label="وذلك عن">
            {allocs.length === 0 ? (
              <span className="text-neutral-500">دفعة تحت الحساب</span>
            ) : (
              <ul className="space-y-0.5">
                {allocs.map((a, i) => (
                  <li key={i}>
                    {describe(a)}
                    <span className="mr-2 text-xs text-neutral-500">({halalasToSar(a.amount_halalas)} ر.س)</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          {credit > 0 && (
            <Row label="رصيد تحت الحساب">
              <span className="text-emerald-700 dark:text-emerald-400">{halalasToSar(credit)} ر.س</span>
            </Row>
          )}
          {payment.notes && <Row label="ملاحظات">{payment.notes}</Row>}
        </div>

        {/* Footer */}
        <footer className="mt-10 flex justify-between text-sm">
          <div className="text-center">
            <p className="text-neutral-500">المستلم</p>
            <div className="mt-8 w-40 border-t border-neutral-300 dark:border-neutral-600" />
          </div>
          <div className="text-center">
            <p className="text-neutral-500">الختم والتوقيع</p>
            <div className="mt-8 w-40 border-t border-neutral-300 dark:border-neutral-600" />
          </div>
        </footer>

        <p className="mt-6 text-center text-[10px] text-neutral-400">
          هذا السند إثبات لاستلام المبلغ أعلاه، وهو مستقلّ عن الفاتورة الضريبية.
        </p>
      </article>
    </div>
  );
}
