import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { CONTRACT_STATUS_AR, CONTRACT_STATUS_TONE, PAYMENT_METHOD_AR } from "@/lib/labels";

export const dynamic = "force-dynamic";

type TenantLink = { tenant_id: string; org_name: string; display_name: string };
type Contract = {
  id: string;
  contract_number: string;
  status: string;
  start_date: string;
  end_date: string;
  annual_rent_halalas: number;
  unit_number: string;
  property_name: string;
};
type Charge = {
  charge_id: string;
  contract_id: string;
  due_date: string;
  gross_halalas: number;
  allocated_halalas: number;
  balance_halalas: number;
  is_settled: boolean;
  is_overdue: boolean;
};
type Payment = {
  id: string;
  receipt_no: string | null;
  amount_halalas: number;
  method: string;
  received_at: string;
};

export default async function TenantPortalDashboard({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const supabase = await createClient();

  const { data: linkData } = await supabase.rpc("my_tenant_links");
  const link = ((linkData ?? []) as TenantLink[]).find((l) => l.tenant_id === tenantId);
  if (!link) redirect("/portal");

  const [{ data: contractData }, { data: chargeData }, { data: payData }] = await Promise.all([
    supabase.rpc("tenant_portal_contracts", { p_tenant: tenantId }),
    supabase.rpc("tenant_portal_charges", { p_tenant: tenantId }),
    supabase.rpc("tenant_portal_payments", { p_tenant: tenantId }),
  ]);

  const contracts = (contractData ?? []) as Contract[];
  const charges = (chargeData ?? []) as Charge[];
  const payments = (payData ?? []) as Payment[];

  const totalDue = charges.reduce((s, c) => s + Number(c.balance_halalas), 0);

  const chargeStatus = (c: Charge) =>
    c.is_settled
      ? ["مدفوع", "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"]
      : c.is_overdue
        ? ["متأخر", "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"]
        : ["غير مدفوع", "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-neutral-500">{link.org_name}</p>
        <h1 className="text-xl font-bold">{link.display_name}</h1>
        <p className="mt-1 text-sm">
          إجمالي المتبقّي عليك: <span className="font-bold">{halalasToSar(totalDue)} ر.س</span>
        </p>
      </header>

      {/* Contracts + their charge schedules */}
      {contracts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد عقود مسجّلة.
        </p>
      ) : (
        contracts.map((ct) => {
          const rows = charges.filter((c) => c.contract_id === ct.id);
          return (
            <section key={ct.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">
                    <span dir="ltr">{ct.contract_number}</span>
                    <span className="mr-2 text-sm font-normal text-neutral-500">
                      {ct.property_name} · وحدة {ct.unit_number}
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-500" dir="ltr">{ct.start_date} → {ct.end_date}</p>
                </div>
                <span className={"rounded-full px-3 py-1 text-xs font-medium " + (CONTRACT_STATUS_TONE[ct.status] ?? "")}>
                  {CONTRACT_STATUS_AR[ct.status] ?? ct.status}
                </span>
              </div>

              {rows.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                      <tr>
                        <th className="px-3 py-2 text-right font-medium">الاستحقاق</th>
                        <th className="px-3 py-2 text-right font-medium">المبلغ (ر.س)</th>
                        <th className="px-3 py-2 text-right font-medium">المسدّد</th>
                        <th className="px-3 py-2 text-right font-medium">المتبقّي</th>
                        <th className="px-3 py-2 text-right font-medium">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {rows.map((c) => {
                        const [label, tone] = chargeStatus(c);
                        return (
                          <tr key={c.charge_id}>
                            <td className="px-3 py-2" dir="ltr">{c.due_date}</td>
                            <td className="px-3 py-2">{halalasToSar(c.gross_halalas)}</td>
                            <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{halalasToSar(c.allocated_halalas)}</td>
                            <td className="px-3 py-2 font-medium">{halalasToSar(c.balance_halalas)}</td>
                            <td className="px-3 py-2">
                              <span className={"rounded-full px-2.5 py-0.5 text-xs font-medium " + tone}>{label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}

      {/* Payments */}
      <section>
        <h2 className="mb-3 text-base font-semibold">دفعاتك</h2>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
            لا توجد دفعات مسجّلة بعد.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2 text-right font-medium">رقم السند</th>
                  <th className="px-4 py-2 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-2 text-right font-medium">المبلغ (ر.س)</th>
                  <th className="px-4 py-2 text-right font-medium">الطريقة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-mono" dir="ltr">{p.receipt_no ?? "—"}</td>
                    <td className="px-4 py-2" dir="ltr">{new Date(p.received_at).toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 font-medium">{halalasToSar(p.amount_halalas)}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{PAYMENT_METHOD_AR[p.method] ?? p.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-[11px] text-neutral-400">
        <Link href="/portal" className="hover:text-brand">← بوابتك</Link>
      </p>
    </div>
  );
}
