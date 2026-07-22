import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { tafqitSar } from "@/lib/tafqit";
import { buildZatcaQrBase64, halalasToDecimal } from "@/lib/zatca";
import { PrintButton } from "@/components/print-button";
import { issueCreditNote, issueDebitNote } from "../actions";

export const dynamic = "force-dynamic";

type Line = {
  description: string;
  quantity: number;
  unit_price_excl_vat_halalas: number;
  vat_rate: number;
  vat_amount_halalas: number;
  line_excl_vat_halalas: number;
  line_incl_vat_halalas: number;
  exemption_reason: string | null;
};

export default async function InvoicePage({
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

  const { data: inv } = await supabase
    .from("invoice")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!inv) notFound();

  const { data: lineData } = await supabase
    .from("invoice_line")
    .select(
      "description, quantity, unit_price_excl_vat_halalas, vat_rate, vat_amount_halalas, line_excl_vat_halalas, line_incl_vat_halalas, exemption_reason",
    )
    .eq("invoice_id", id);
  const lines = (lineData ?? []) as Line[];

  const docKind = (inv.doc_kind ?? "invoice") as "invoice" | "credit_note" | "debit_note";
  const isNote = docKind !== "invoice";

  // For a note: the referenced original invoice number. For an issued invoice: any note referencing it.
  let refInvoiceNo: string | null = null;
  let relatedNotes: Array<{ id: string; invoice_no: string | null; doc_kind: string }> = [];
  if (isNote && inv.ref_invoice_id) {
    const { data: ref } = await supabase
      .from("invoice").select("invoice_no").eq("id", inv.ref_invoice_id).maybeSingle();
    refInvoiceNo = ref?.invoice_no ?? null;
  } else if (!isNote) {
    const { data: notes } = await supabase
      .from("invoice").select("id, invoice_no, doc_kind").eq("ref_invoice_id", id).is("deleted_at", null);
    relatedNotes = (notes ?? []) as typeof relatedNotes;
  }

  const isTax = inv.invoice_type !== "plain" && !!inv.supplier_vat_number;
  const issuedIso = new Date(inv.issue_at).toISOString();
  const issuedDisplay = issuedIso.slice(0, 16).replace("T", " ");

  // ZATCA Phase-1 QR — only meaningful when the supplier is VAT-registered.
  let qrSvg: string | null = null;
  if (isTax) {
    const base64 = buildZatcaQrBase64({
      sellerName: inv.supplier_name ?? "",
      vatNumber: inv.supplier_vat_number ?? "",
      timestamp: issuedIso,
      total: halalasToDecimal(inv.total_incl_vat_halalas),
      vatTotal: halalasToDecimal(inv.total_vat_halalas),
    });
    qrSvg = await QRCode.toString(base64, { type: "svg", margin: 1, width: 150 });
  }

  const title =
    docKind === "credit_note"
      ? "إشعار دائن"
      : docKind === "debit_note"
        ? "إشعار مدين"
        : isTax
          ? "فاتورة ضريبية مبسطة"
          : "فاتورة";
  const titleEn =
    docKind === "credit_note"
      ? "Credit Note"
      : docKind === "debit_note"
        ? "Debit Note"
        : isTax
          ? "Simplified Tax Invoice"
          : "Invoice";
  const canIssueNotes = docKind === "invoice" && inv.status === "issued";
  const docNoun =
    docKind === "credit_note" ? "الإشعار الدائن" : docKind === "debit_note" ? "الإشعار المدين" : "الفاتورة";
  const creditNote = relatedNotes.find((n) => n.doc_kind === "credit_note");

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex gap-2">
      <span className="text-neutral-500">{label}:</span>
      <span className="font-medium">{children}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <nav className="text-sm text-neutral-500">
          <Link href="/app/invoices" className="hover:text-brand">الفواتير</Link> /{" "}
          <span className="text-neutral-700 dark:text-neutral-300" dir="ltr">{inv.invoice_no ?? "—"}</span>
        </nav>
        <PrintButton label={`طباعة ${docNoun}`} />
      </div>

      {flashError && (
        <p className="no-print rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

      <article className="print-sheet mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <header className="mb-6 flex items-start justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
          <div>
            <h1 className="text-lg font-bold">{inv.supplier_name ?? "المورّد"}</h1>
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              {inv.supplier_cr_number && <p>س.ت: <span dir="ltr">{inv.supplier_cr_number}</span></p>}
              {inv.supplier_vat_number && <p>الرقم الضريبي: <span dir="ltr">{inv.supplier_vat_number}</span></p>}
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-extrabold text-brand">{title}</h2>
            <p className="mt-1 text-xs text-neutral-500">{titleEn}</p>
          </div>
        </header>

        {/* Reference / status banners */}
        {isNote && (
          <p className="mb-4 rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
            {docKind === "credit_note" ? "إشعار دائن (خصم/إلغاء) " : "إشعار مدين (إضافة) "}
            بالإشارة إلى الفاتورة <span className="font-mono font-medium" dir="ltr">{refInvoiceNo ?? "—"}</span>
            {inv.reason && <span className="block text-neutral-600 dark:text-neutral-300">السبب: {inv.reason}</span>}
          </p>
        )}
        {!isNote && inv.status === "cancelled" && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            فاتورة ملغاة
            {creditNote && (
              <>
                {" "}بموجب{" "}
                <Link href={`/app/invoices/${creditNote.id}`} className="font-mono underline" dir="ltr">
                  {creditNote.invoice_no}
                </Link>
              </>
            )}
          </p>
        )}

        {!isTax && !isNote && (
          <p className="no-print mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            المورّد بلا رقم ضريبي، لذا هذه فاتورة عادية (ليست فاتورة ضريبية ولا تحمل رمز QR). أضِف الرقم الضريبي للمالك/المنشأة لإصدار فاتورة ضريبية.
          </p>
        )}

        {/* Meta + parties */}
        <div className="mb-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <Field label={`رقم ${docNoun}`}><span dir="ltr">{inv.invoice_no ?? "—"}</span></Field>
            <Field label="تاريخ الإصدار"><span dir="ltr">{issuedDisplay}</span></Field>
            {inv.supply_date && <Field label="تاريخ التوريد"><span dir="ltr">{inv.supply_date}</span></Field>}
          </div>
          <div className="space-y-1">
            <Field label="المشتري">{inv.buyer_name ?? "—"}</Field>
            {inv.buyer_id && <Field label="هوية المشتري"><span dir="ltr">{inv.buyer_id}</span></Field>}
            {inv.buyer_vat_number && <Field label="الرقم الضريبي للمشتري"><span dir="ltr">{inv.buyer_vat_number}</span></Field>}
          </div>
        </div>

        {/* Lines */}
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-800/50">
              <tr>
                <th className="px-3 py-2 text-right font-medium">البند</th>
                <th className="px-3 py-2 text-right font-medium">الكمية</th>
                <th className="px-3 py-2 text-right font-medium">السعر (غير شامل)</th>
                <th className="px-3 py-2 text-right font-medium">الضريبة</th>
                <th className="px-3 py-2 text-right font-medium">الإجمالي (شامل)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    {l.description}
                    {l.exemption_reason && (
                      <span className="block text-xs text-neutral-400">{l.exemption_reason}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{Number(l.quantity)}</td>
                  <td className="px-3 py-2">{halalasToSar(l.unit_price_excl_vat_halalas)}</td>
                  <td className="px-3 py-2">
                    {halalasToSar(l.vat_amount_halalas)}
                    <span className="text-xs text-neutral-400"> ({(Number(l.vat_rate) * 100).toFixed(0)}%)</span>
                  </td>
                  <td className="px-3 py-2 font-medium">{halalasToSar(l.line_incl_vat_halalas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals + QR */}
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          {qrSvg ? (
            <div
              className="h-[150px] w-[150px] shrink-0"
              // QR is generated server-side from the invoice's own snapshot fields.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <div />
          )}
          <dl className="min-w-[220px] space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">الإجمالي غير شامل الضريبة</dt>
              <dd>{halalasToSar(inv.total_excl_vat_halalas)} ر.س</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">ضريبة القيمة المضافة</dt>
              <dd>{halalasToSar(inv.total_vat_halalas)} ر.س</dd>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-1 text-base font-bold dark:border-neutral-700">
              <dt>الإجمالي المستحق</dt>
              <dd>{halalasToSar(inv.total_incl_vat_halalas)} ر.س</dd>
            </div>
          </dl>
        </div>

        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">{tafqitSar(inv.total_incl_vat_halalas)}</p>

        <p className="mt-6 border-t border-neutral-100 pt-4 text-center text-[10px] text-neutral-400 dark:border-neutral-800">
          {isNote
            ? "هذا الإشعار يعدّل الفاتورة المشار إليها أعلاه."
            : "هذه الفاتورة تُوثّق التوريد وضريبته، وهي مستقلّة عن سداد المبلغ. يُثبت السداد بسند القبض."}
        </p>
      </article>

      {/* Related notes on an issued invoice */}
      {!isNote && relatedNotes.length > 0 && (
        <section className="no-print mx-auto max-w-3xl">
          <h3 className="mb-2 text-sm font-semibold">الإشعارات المرتبطة</h3>
          <ul className="space-y-1 text-sm">
            {relatedNotes.map((n) => (
              <li key={n.id}>
                <Link href={`/app/invoices/${n.id}`} className="text-brand hover:underline">
                  {n.doc_kind === "credit_note" ? "إشعار دائن" : "إشعار مدين"}{" "}
                  <span className="font-mono" dir="ltr">{n.invoice_no}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Credit / debit note actions — only on an issued invoice */}
      {canIssueNotes && (
        <section className="no-print mx-auto max-w-3xl space-y-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-base font-semibold">تعديل الفاتورة</h3>
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Credit note */}
            <form action={issueCreditNote} className="space-y-2 rounded-xl border border-neutral-100 p-3 dark:border-neutral-800">
              <p className="text-sm font-medium">إشعار دائن (إلغاء الفاتورة)</p>
              <p className="text-xs text-neutral-500">يلغي الفاتورة بالكامل ويحرّر استحقاقها لإعادة الإصدار.</p>
              <input type="hidden" name="invoice_id" value={inv.id} />
              <input
                name="reason"
                required
                placeholder="سبب الإلغاء (مثال: خطأ في الإصدار)"
                className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
              />
              <button className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
                إصدار إشعار دائن
              </button>
            </form>

            {/* Debit note */}
            <form action={issueDebitNote} className="space-y-2 rounded-xl border border-neutral-100 p-3 dark:border-neutral-800">
              <p className="text-sm font-medium">إشعار مدين (إضافة مبلغ)</p>
              <p className="text-xs text-neutral-500">يضيف مبلغاً على الفاتورة (تُطبَّق نسبة ضريبتها).</p>
              <input type="hidden" name="invoice_id" value={inv.id} />
              <input
                name="description"
                placeholder="الوصف (مثال: غرامة تأخير)"
                className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
              />
              <div className="flex gap-2">
                <input
                  name="amount"
                  inputMode="decimal"
                  placeholder="المبلغ (ر.س، غير شامل)"
                  className="w-40 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
                <input
                  name="reason"
                  required
                  placeholder="السبب"
                  className="flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
              </div>
              <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                إصدار إشعار مدين
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
