import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { tafqitSar } from "@/lib/tafqit";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

type Receipt = {
  receipt_no: string | null;
  amount_halalas: number;
  method: string;
  received_at: string;
  reference: string | null;
  notes: string | null;
  payer_name: string | null;
  payer_id: string | null;
  org_name: string | null;
  org_cr: string | null;
  org_vat: string | null;
};
type Line = { description: string | null; amount_halalas: number; contract_number: string | null; unit_number: string | null; property_name: string | null };

export default async function TenantReceiptPage({
  params,
}: {
  params: Promise<{ tenantId: string; paymentId: string }>;
}) {
  const { tenantId, paymentId } = await params;
  const supabase = await createClient();

  // Confirm the tenant belongs to the caller (avoids the RPC throwing FORBIDDEN).
  const { data: links } = await supabase.rpc("my_tenant_links");
  if (!((links ?? []) as { tenant_id: string }[]).some((l) => l.tenant_id === tenantId)) redirect("/portal");

  const [{ data: recData }, { data: lineData }] = await Promise.all([
    supabase.rpc("tenant_portal_receipt", { p_tenant: tenantId, p_payment: paymentId }),
    supabase.rpc("tenant_portal_receipt_lines", { p_tenant: tenantId, p_payment: paymentId }),
  ]);
  const rec = ((recData ?? []) as Receipt[])[0];
  if (!rec) notFound();
  const lines = (lineData ?? []) as Line[];
  const receivedDate = new Date(rec.received_at).toISOString().slice(0, 10);

  const describe = (l: Line) =>
    [l.description, l.contract_number ? `عقد ${l.contract_number}` : null, l.unit_number ? `وحدة ${l.unit_number}` : null, l.property_name]
      .filter(Boolean)
      .join(" — ");

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
          <Link href={`/portal/tenant/${tenantId}`} className="hover:text-brand">بوابتي</Link> /{" "}
          <span className="text-neutral-700 dark:text-neutral-300" dir="ltr">{rec.receipt_no ?? "—"}</span>
        </nav>
        <PrintButton label="طباعة السند" />
      </div>

      <article className="print-sheet mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <header className="mb-6 flex items-start justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
          <div>
            <h1 className="text-lg font-bold">{rec.org_name ?? "المنشأة"}</h1>
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              {rec.org_cr && <p>س.ت: <span dir="ltr">{rec.org_cr}</span></p>}
              {rec.org_vat && <p>الرقم الضريبي: <span dir="ltr">{rec.org_vat}</span></p>}
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-extrabold text-brand">سند قبض</h2>
            <p className="mt-1 text-xs text-neutral-500">Receipt Voucher</p>
          </div>
        </header>

        <div className="mb-4 flex justify-between text-sm">
          <span>رقم السند: <span className="font-mono font-bold" dir="ltr">{rec.receipt_no ?? "—"}</span></span>
          <span>التاريخ: <span dir="ltr">{receivedDate}</span></span>
        </div>

        <div className="space-y-1">
          <Row label="استلمنا من">
            {rec.payer_name ?? "—"}
            {rec.payer_id && <span className="mr-2 text-xs text-neutral-500" dir="ltr">هوية/إقامة: {rec.payer_id}</span>}
          </Row>
          <Row label="مبلغاً وقدره"><span className="text-base">{halalasToSar(rec.amount_halalas)} ر.س</span></Row>
          <Row label="فقط"><span className="font-normal">{tafqitSar(rec.amount_halalas)}</span></Row>
          <Row label="طريقة الدفع">
            {PAYMENT_METHOD_AR[rec.method] ?? rec.method}
            {rec.reference && <span className="mr-2 text-xs text-neutral-500" dir="ltr">مرجع: {rec.reference}</span>}
          </Row>
          <Row label="وذلك عن">
            {lines.length === 0 ? (
              <span className="text-neutral-500">دفعة تحت الحساب</span>
            ) : (
              <ul className="space-y-0.5">
                {lines.map((l, i) => (
                  <li key={i}>
                    {describe(l)}
                    <span className="mr-2 text-xs text-neutral-500">({halalasToSar(l.amount_halalas)} ر.س)</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          {rec.notes && <Row label="ملاحظات">{rec.notes}</Row>}
        </div>

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

        <p className="mt-6 text-center text-[10px] text-neutral-400">هذا السند إثبات لاستلام المبلغ أعلاه.</p>
      </article>
    </div>
  );
}
