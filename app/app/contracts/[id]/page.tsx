import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { activateContract, recordPayment, issueInvoice } from "../actions";
import {
  CONTRACT_STATUS_AR,
  CONTRACT_STATUS_TONE,
  FREQUENCY_AR,
  PAYMENT_METHOD_AR,
} from "@/lib/labels";
import { halalasToSar } from "@/lib/money";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const first = (x: any) => (Array.isArray(x) ? x[0] : x);

const PAYMENT_METHODS: Array<[string, string]> = [
  ["cash", "نقداً"],
  ["bank_transfer", "تحويل بنكي"],
  ["mada", "مدى"],
  ["apple_pay", "Apple Pay"],
  ["sadad", "سداد"],
  ["cheque", "شيك"],
  ["card", "بطاقة"],
];

type ChargeBal = {
  charge_id: string;
  due_date: string;
  gross_halalas: number;
  allocated_halalas: number;
  balance_halalas: number;
  is_settled: boolean;
  is_overdue: boolean;
};

type PaymentLine = {
  id: string;
  receipt_no: string | null;
  amount_halalas: number;
  method: string;
  received_at: string;
};

export default async function ContractDetail({
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

  const { data: contract } = await supabase
    .from("contract")
    .select(
      "id, contract_number, status, contract_kind, start_date, end_date, annual_rent_halalas, payment_frequency, deposit_halalas, service_fees_halalas, deed_number, unit:unit_id(unit_number, property:property_id(name)), tenant:tenant_id(party:party_id(display_name))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!contract) notFound();

  const { data: chargeData } = await supabase
    .from("charge_balance")
    .select(
      "charge_id, due_date, gross_halalas, allocated_halalas, balance_halalas, is_settled, is_overdue",
    )
    .eq("contract_id", id)
    .order("due_date", { ascending: true });

  const charges = (chargeData ?? []) as ChargeBal[];

  // Payments allocated to this contract's charges → their receipt vouchers.
  const chargeIds = charges.map((c) => c.charge_id);
  let payments: PaymentLine[] = [];
  if (chargeIds.length > 0) {
    const { data: allocRows } = await supabase
      .from("payment_allocation")
      .select("payment:payment_id(id, receipt_no, amount_halalas, method, received_at)")
      .in("charge_id", chargeIds);
    const map = new Map<string, PaymentLine>();
    for (const r of (allocRows ?? []) as any[]) {
      const p = first(r.payment) as PaymentLine | undefined;
      if (p && !map.has(p.id)) map.set(p.id, p);
    }
    payments = [...map.values()].sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
  }

  // Issued invoices for this contract → map by charge_id.
  const { data: invData } = await supabase
    .from("invoice")
    .select("id, charge_id, invoice_no")
    .eq("contract_id", id)
    .eq("doc_kind", "invoice")
    .eq("status", "issued")
    .is("deleted_at", null);
  const invoiceByCharge = new Map<string, { id: string; invoice_no: string | null }>();
  for (const r of (invData ?? []) as any[]) {
    if (r.charge_id) invoiceByCharge.set(r.charge_id, { id: r.id, invoice_no: r.invoice_no });
  }

  const unit = first((contract as any).unit);
  const tenant = first((contract as any).tenant);

  const totalGross = charges.reduce((s, c) => s + Number(c.gross_halalas), 0);
  const totalPaid = charges.reduce((s, c) => s + Number(c.allocated_halalas), 0);
  const totalBalance = totalGross - totalPaid;

  const Info = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/contracts" className="hover:text-brand">
          العقود
        </Link>{" "}
        / <span className="text-neutral-700 dark:text-neutral-300" dir="ltr">{contract.contract_number}</span>
      </nav>

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

      <header className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold" dir="ltr">
            {contract.contract_number}
          </h1>
          <span
            className={
              "rounded-full px-3 py-1 text-sm font-medium " +
              (CONTRACT_STATUS_TONE[contract.status] ?? "")
            }
          >
            {CONTRACT_STATUS_AR[contract.status] ?? contract.status}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Info label="العقار" value={first(unit?.property)?.name ?? "—"} />
          <Info label="الوحدة" value={unit?.unit_number ?? "—"} />
          <Info label="المستأجر" value={first(tenant?.party)?.display_name ?? "—"} />
          <Info label="نوع العقد" value={contract.contract_kind === "commercial" ? "تجاري" : "سكني"} />
          <Info label="دورية الدفع" value={FREQUENCY_AR[contract.payment_frequency] ?? contract.payment_frequency} />
          <Info label="المدة" value={<span dir="ltr">{contract.start_date} → {contract.end_date}</span>} />
          <Info label="الإيجار السنوي" value={`${halalasToSar(contract.annual_rent_halalas)} ر.س`} />
          <Info label="التأمين" value={`${halalasToSar(contract.deposit_halalas)} ر.س`} />
          <Info label="رسوم الخدمات" value={`${halalasToSar(contract.service_fees_halalas)} ر.س`} />
        </dl>

        {contract.status === "draft" && (
          <div className="mt-6 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
              العقد مسودة. تفعيله يولّد جدول الاستحقاقات تلقائياً ويجعل الوحدة «مؤجرة». بعد التفعيل لا يمكن تعديل بنوده.
            </p>
            <form action={activateContract}>
              <input type="hidden" name="contract_id" value={contract.id} />
              <button className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg">
                تفعيل العقد
              </button>
            </form>
          </div>
        )}
      </header>

      {contract.status !== "draft" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">جدول الاستحقاقات</h2>
            <span className="text-sm text-neutral-500">
              المتبقّي: {halalasToSar(totalBalance)} من {halalasToSar(totalGross)} ر.س
            </span>
          </div>

          {charges.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
              لا توجد استحقاقات.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">تاريخ الاستحقاق</th>
                    <th className="px-3 py-2 text-right font-medium">المبلغ (ر.س)</th>
                    <th className="px-3 py-2 text-right font-medium">المسدّد</th>
                    <th className="px-3 py-2 text-right font-medium">المتبقّي</th>
                    <th className="px-3 py-2 text-right font-medium">الحالة</th>
                    <th className="px-3 py-2 text-right font-medium">الفاتورة</th>
                    <th className="px-3 py-2 text-right font-medium">تسجيل دفعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {charges.map((c) => {
                    const tone = c.is_settled
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : c.is_overdue
                        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
                    const label = c.is_settled ? "مدفوع" : c.is_overdue ? "متأخر" : "غير مدفوع";
                    return (
                      <tr key={c.charge_id}>
                        <td className="px-3 py-2" dir="ltr">{c.due_date}</td>
                        <td className="px-3 py-2">{halalasToSar(c.gross_halalas)}</td>
                        <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                          {halalasToSar(c.allocated_halalas)}
                        </td>
                        <td className="px-3 py-2 font-medium">{halalasToSar(c.balance_halalas)}</td>
                        <td className="px-3 py-2">
                          <span className={"rounded-full px-2.5 py-0.5 text-xs font-medium " + tone}>
                            {label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {invoiceByCharge.has(c.charge_id) ? (
                            <Link
                              href={`/app/invoices/${invoiceByCharge.get(c.charge_id)!.id}`}
                              className="font-mono text-xs text-brand hover:underline"
                              dir="ltr"
                            >
                              {invoiceByCharge.get(c.charge_id)!.invoice_no ?? "عرض"}
                            </Link>
                          ) : (
                            <form action={issueInvoice}>
                              <input type="hidden" name="contract_id" value={contract.id} />
                              <input type="hidden" name="charge_id" value={c.charge_id} />
                              <button className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                                إصدار
                              </button>
                            </form>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.is_settled ? (
                            <span className="text-xs text-neutral-400">—</span>
                          ) : (
                            <form action={recordPayment} className="flex items-center gap-1">
                              <input type="hidden" name="contract_id" value={contract.id} />
                              <input type="hidden" name="charge_id" value={c.charge_id} />
                              <input
                                name="amount"
                                inputMode="decimal"
                                defaultValue={(Number(c.balance_halalas) / 100).toString()}
                                className="w-24 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-brand dark:border-neutral-700"
                              />
                              <select
                                name="method"
                                defaultValue="cash"
                                className="rounded border border-neutral-300 bg-transparent px-1 py-1 text-xs outline-none dark:border-neutral-700"
                              >
                                {PAYMENT_METHODS.map(([v, l]) => (
                                  <option key={v} value={v}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                              <button className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-fg">
                                دفع
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {contract.status !== "draft" && payments.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">الدفعات المستلمة</h2>
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">رقم السند</th>
                  <th className="px-3 py-2 text-right font-medium">التاريخ</th>
                  <th className="px-3 py-2 text-right font-medium">المبلغ (ر.س)</th>
                  <th className="px-3 py-2 text-right font-medium">الطريقة</th>
                  <th className="px-3 py-2 text-right font-medium">سند القبض</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-mono font-medium" dir="ltr">{p.receipt_no ?? "—"}</td>
                    <td className="px-3 py-2" dir="ltr">{new Date(p.received_at).toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-2 font-medium">{halalasToSar(p.amount_halalas)}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{PAYMENT_METHOD_AR[p.method] ?? p.method}</td>
                    <td className="px-3 py-2">
                      <Link href={`/app/receipts/${p.id}`} className="text-brand hover:underline">
                        عرض / طباعة ←
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
