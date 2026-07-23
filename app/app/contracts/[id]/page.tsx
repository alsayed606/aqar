import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import {
  activateContract,
  recordPayment,
  issueInvoice,
  amendRent,
  terminateContract,
  renewContract,
  activateRenewal,
} from "../actions";
import {
  CONTRACT_STATUS_AR,
  CONTRACT_STATUS_TONE,
  FREQUENCY_AR,
  PAYMENT_METHOD_AR,
  AMENDMENT_TYPE_AR,
} from "@/lib/labels";
import { halalasToSar } from "@/lib/money";
import { first } from "@/lib/rows";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

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

type Amendment = {
  id: string;
  version: number;
  change_type: string;
  payload: any;
  effective_date: string;
  reason: string | null;
  created_at: string;
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
      "id, contract_number, status, contract_kind, start_date, end_date, annual_rent_halalas, payment_frequency, deposit_halalas, service_fees_halalas, deed_number, terminated_at, termination_reason, renewed_from_contract_id, unit:unit_id(unit_number, property:property_id(name)), tenant:tenant_id(party:party_id(display_name))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!contract) notFound();

  // Renewal lineage: the predecessor this was renewed from, and any successor renewed off it.
  const [{ data: predecessor }, { data: successor }] = await Promise.all([
    contract.renewed_from_contract_id
      ? supabase
          .from("contract")
          .select("id, contract_number, status")
          .eq("id", contract.renewed_from_contract_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("contract")
      .select("id, contract_number, status")
      .eq("renewed_from_contract_id", id)
      .neq("status", "cancelled")
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  const { data: amendData } = await supabase
    .from("contract_amendment")
    .select("id, version, change_type, payload, effective_date, reason, created_at")
    .eq("contract_id", id)
    .order("version", { ascending: false });
  const amendments = (amendData ?? []) as Amendment[];

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

  // Renewal defaults: a 1-year successor starting the day after the current end date.
  const shiftDate = (iso: string, years: number, days: number) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + years);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const renewStart = shiftDate(contract.end_date, 0, 1);
  const renewEnd = shiftDate(renewStart, 1, -1);

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

        {(predecessor || successor) && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-neutral-100 pt-3 text-sm dark:border-neutral-800">
            {predecessor && (
              <span className="text-neutral-500">
                مجدَّد من:{" "}
                <Link href={`/app/contracts/${predecessor.id}`} className="text-brand hover:underline" dir="ltr">
                  {predecessor.contract_number}
                </Link>
              </span>
            )}
            {successor && (
              <span className="text-neutral-500">
                جُدِّد بعقد لاحق:{" "}
                <Link href={`/app/contracts/${successor.id}`} className="text-brand hover:underline" dir="ltr">
                  {successor.contract_number}
                </Link>{" "}
                <span className="text-xs">({CONTRACT_STATUS_AR[successor.status] ?? successor.status})</span>
              </span>
            )}
          </div>
        )}

        {contract.status === "draft" &&
          (contract.renewed_from_contract_id ? (
            <div className="mt-6 border-t border-neutral-100 pt-4 dark:border-neutral-800">
              <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
                عقد تجديد (مسودة). تفعيله يُنهي العقد السابق تلقائياً (يصبح «منتهياً» ويُلغى ما تبقّى من
                استحقاقاته المستقبلية غير المدفوعة)، ثم يبدأ هذا العقد ويولّد جدول استحقاقاته. بعد التفعيل لا
                يمكن تعديل بنوده.
              </p>
              <form action={activateRenewal}>
                <input type="hidden" name="contract_id" value={contract.id} />
                <button className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg">
                  تفعيل التجديد
                </button>
              </form>
            </div>
          ) : (
            <div className="mt-6 border-t border-neutral-100 pt-4 dark:border-neutral-800">
              <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
                العقد مسودة. تفعيله يولّد جدول الاستحقاقات تلقائياً ويجعل الوحدة «مؤجرة». بعد التفعيل لا يمكن
                تعديل بنوده.
              </p>
              <form action={activateContract}>
                <input type="hidden" name="contract_id" value={contract.id} />
                <button className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg">
                  تفعيل العقد
                </button>
              </form>
            </div>
          ))}
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

      {/* Termination banner */}
      {contract.status === "terminated" && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
          عقد مُنهى{contract.terminated_at ? ` بتاريخ ${new Date(contract.terminated_at).toISOString().slice(0, 10)}` : ""}
          {contract.termination_reason ? ` — السبب: ${contract.termination_reason}` : ""}
        </section>
      )}

      {/* Amendments (ملاحق العقد) */}
      {contract.status !== "draft" && (
        <section>
          <h2 className="mb-3 text-base font-semibold">ملاحق العقد</h2>

          {amendments.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">#</th>
                    <th className="px-3 py-2 text-right font-medium">النوع</th>
                    <th className="px-3 py-2 text-right font-medium">التغيير</th>
                    <th className="px-3 py-2 text-right font-medium">يسري من</th>
                    <th className="px-3 py-2 text-right font-medium">السبب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {amendments.map((a) => (
                    <tr key={a.id}>
                      <td className="px-3 py-2">{a.version}</td>
                      <td className="px-3 py-2 font-medium">{AMENDMENT_TYPE_AR[a.change_type] ?? a.change_type}</td>
                      <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                        {a.change_type === "rent_change" && a.payload?.annual_rent_halalas
                          ? `${halalasToSar(a.payload.annual_rent_halalas.from)} ← ${halalasToSar(a.payload.annual_rent_halalas.to)} ر.س`
                          : "—"}
                      </td>
                      <td className="px-3 py-2" dir="ltr">{a.effective_date}</td>
                      <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{a.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {contract.status === "active" && (
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Rent change */}
              <form action={amendRent} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-sm font-medium">تعديل الإيجار</p>
                <p className="text-xs text-neutral-500">يُعيد تسعير الاستحقاقات المستقبلية غير المدفوعة من تاريخ السريان.</p>
                <input type="hidden" name="contract_id" value={contract.id} />
                <div className="flex flex-wrap gap-2">
                  <input
                    name="new_annual"
                    inputMode="decimal"
                    placeholder="الإيجار السنوي الجديد (ر.س)"
                    className="w-44 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                  />
                  <input
                    name="effective_date"
                    type="date"
                    className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700"
                  />
                </div>
                <input
                  name="reason"
                  placeholder="سبب التعديل"
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
                <button className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg">
                  حفظ ملحق التعديل
                </button>
              </form>

              {/* Early termination */}
              <form action={terminateContract} className="space-y-2 rounded-2xl border border-red-200 bg-white p-4 shadow-sm dark:border-red-900/40 dark:bg-neutral-900">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">إنهاء مبكر</p>
                <p className="text-xs text-neutral-500">يُنهي العقد ويلغي الاستحقاقات المستقبلية غير المدفوعة ويُحرّر الوحدة.</p>
                <input type="hidden" name="contract_id" value={contract.id} />
                <input
                  name="effective_date"
                  type="date"
                  className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700"
                />
                <input
                  name="reason"
                  placeholder="سبب الإنهاء"
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
                <button className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700">
                  إنهاء العقد
                </button>
              </form>
            </div>
          )}

          {amendments.length === 0 && contract.status !== "active" && (
            <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
              لا توجد ملاحق على هذا العقد.
            </p>
          )}
        </section>
      )}

      {/* Renewal (تجديد العقد بعقد لاحق) */}
      {(contract.status === "active" || contract.status === "expired") && !successor && (
        <section>
          <h2 className="mb-3 text-base font-semibold">تجديد العقد</h2>
          <form
            action={renewContract}
            className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <p className="text-xs text-neutral-500">
              يُنشئ عقداً لاحقاً (مسودة) بنفس الوحدة والمستأجر — لا يُعدّل هذا العقد. تُراجع المسودة ثم تُفعّلها،
              وعندها يصبح هذا العقد «منتهياً» ويبدأ العقد الجديد.
            </p>
            <input type="hidden" name="contract_id" value={contract.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-0.5 block text-xs text-neutral-500">بداية العقد الجديد</span>
                <input
                  name="start_date"
                  type="date"
                  defaultValue={renewStart}
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-0.5 block text-xs text-neutral-500">نهاية العقد الجديد</span>
                <input
                  name="end_date"
                  type="date"
                  defaultValue={renewEnd}
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-0.5 block text-xs text-neutral-500">الإيجار السنوي الجديد (ر.س)</span>
                <input
                  name="new_annual"
                  inputMode="decimal"
                  defaultValue={(Number(contract.annual_rent_halalas) / 100).toString()}
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-0.5 block text-xs text-neutral-500">رقم العقد الجديد (اختياري)</span>
                <input
                  name="contract_number"
                  placeholder="يُشتق تلقائياً من رقم العقد"
                  dir="ltr"
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
                />
              </label>
            </div>
            <button className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg">
              إنشاء عقد التجديد
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
