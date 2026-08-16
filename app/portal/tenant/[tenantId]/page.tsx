import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import { CONTRACT_STATUS_AR, PAYMENT_METHOD_AR } from "@/lib/labels";
import { Card, CardBody, Badge, Tabs } from "@/components/ui";
import { MaintenanceRequestForm, type PortalUnit } from "@/components/maintenance-request-form";
import { MAINTENANCE_CATEGORY_AR, MAINTENANCE_URGENCY_AR, MAINTENANCE_STATUS_AR } from "@/lib/labels";

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
type PortalUnitRow = { unit_id: string; unit_number: string; property_name: string };
type MaintenanceLine = {
  id: string;
  request_no: string | null;
  category: string;
  urgency: string;
  status: string;
  description: string;
  unit_number: string | null;
  created_at: string;
  resolved_at: string | null;
};
type Payment = {
  id: string;
  receipt_no: string | null;
  amount_halalas: number;
  method: string;
  received_at: string;
};

function chargeBadge(c: Charge) {
  if (c.is_settled) return <Badge tone="success">مدفوع</Badge>;
  if (c.is_overdue) return <Badge tone="danger">متأخر</Badge>;
  return <Badge tone="warning">غير مدفوع</Badge>;
}

export default async function TenantPortalDashboard({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const supabase = await createClient();

  const { data: linkData } = await supabase.rpc("my_tenant_links");
  const link = ((linkData ?? []) as TenantLink[]).find((l) => l.tenant_id === tenantId);
  if (!link) redirect("/portal");

  const [{ data: contractData }, { data: chargeData }, { data: payData }, { data: maintData }, { data: unitData }] =
    await Promise.all([
    supabase.rpc("tenant_portal_contracts", { p_tenant: tenantId }),
    supabase.rpc("tenant_portal_charges", { p_tenant: tenantId }),
    supabase.rpc("tenant_portal_payments", { p_tenant: tenantId }),
    supabase.rpc("tenant_portal_maintenance", { p_tenant: tenantId }),
    supabase.rpc("tenant_portal_units", { p_tenant: tenantId }),
  ]);

  const contracts = (contractData ?? []) as Contract[];
  const charges = (chargeData ?? []) as Charge[];
  const payments = (payData ?? []) as Payment[];

  const requests = (maintData ?? []) as MaintenanceLine[];
  const totalDue = charges.reduce((s, c) => s + Number(c.balance_halalas), 0);

  // Active contracts only (0073) — the same rule submit_maintenance_request enforces. Offering a
  // wider list would only produce refusals the tenant cannot act on.
  const openUnits: PortalUnit[] = ((unitData ?? []) as PortalUnitRow[]).map((u) => ({
    unit_id: u.unit_id,
    label: `${u.property_name} — وحدة ${u.unit_number}`,
  }));

  const contractsTab =
    contracts.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">لا توجد عقود مسجّلة.</p>
    ) : (
      <div className="space-y-5">
        {contracts.map((ct) => {
          const rows = charges.filter((c) => c.contract_id === ct.id);
          return (
            <Card key={ct.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      <span dir="ltr">{ct.contract_number}</span>
                      <span className="mr-2 text-sm font-normal text-slate-500">{ct.property_name} · وحدة {ct.unit_number}</span>
                    </h3>
                    <p className="text-xs text-slate-500" dir="ltr">{ct.start_date} → {ct.end_date}</p>
                  </div>
                  <Badge tone={ct.status === "active" ? "success" : "neutral"}>{CONTRACT_STATUS_AR[ct.status] ?? ct.status}</Badge>
                </div>

                {rows.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
                        <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                          <th>الاستحقاق</th>
                          <th>المبلغ (ر.س)</th>
                          <th>المسدّد</th>
                          <th>المتبقّي</th>
                          <th>الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {rows.map((c) => (
                          <tr key={c.charge_id} className="[&>td]:px-3 [&>td]:py-2">
                            <td dir="ltr">{c.due_date}</td>
                            <td>{halalasToSar(c.gross_halalas)}</td>
                            <td className="text-slate-600 dark:text-slate-300">{halalasToSar(c.allocated_halalas)}</td>
                            <td className="font-medium">{halalasToSar(c.balance_halalas)}</td>
                            <td>{chargeBadge(c)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    );

  const paymentsTab =
    payments.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">لا توجد دفعات مسجّلة بعد.</p>
    ) : (
      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
              <th>رقم السند</th>
              <th>التاريخ</th>
              <th>المبلغ (ر.س)</th>
              <th>الطريقة</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {payments.map((p) => (
              <tr key={p.id} className="[&>td]:px-4 [&>td]:py-2">
                <td className="font-mono" dir="ltr">{p.receipt_no ?? "—"}</td>
                <td dir="ltr">{new Date(p.received_at).toISOString().slice(0, 10)}</td>
                <td className="font-medium">{halalasToSar(p.amount_halalas)}</td>
                <td className="text-slate-600 dark:text-slate-300">{PAYMENT_METHOD_AR[p.method] ?? p.method}</td>
                <td><Link href={`/portal/tenant/${tenantId}/receipt/${p.id}`} className="text-brand hover:underline">السند / طباعة ←</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const maintenanceTab = (
    <div className="space-y-5">
      <Card>
        <CardBody className="space-y-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">طلب صيانة جديد</h3>
          <MaintenanceRequestForm tenantId={tenantId} units={openUnits} />
        </CardBody>
      </Card>

      {requests.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                <th>الرقم</th>
                <th>الوحدة</th>
                <th>النوع</th>
                <th>الأهمية</th>
                <th>الحالة</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {requests.map((r) => (
                <tr key={r.id} className="[&>td]:px-4 [&>td]:py-2">
                  <td className="font-mono" dir="ltr">{r.request_no ?? "—"}</td>
                  <td>{r.unit_number ?? "—"}</td>
                  <td className="text-slate-600 dark:text-slate-300">{MAINTENANCE_CATEGORY_AR[r.category] ?? r.category}</td>
                  <td className="text-slate-600 dark:text-slate-300">{MAINTENANCE_URGENCY_AR[r.urgency] ?? r.urgency}</td>
                  <td>
                    <Badge tone={r.status === "resolved" ? "success" : r.status === "in_progress" ? "info" : r.status === "cancelled" ? "neutral" : "warning"}>
                      {MAINTENANCE_STATUS_AR[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td dir="ltr">{new Date(r.created_at).toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{link.org_name}</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{link.display_name}</h1>
        </div>
        <Card>
          <CardBody className="p-4 text-center">
            <p className="text-xs text-slate-500">إجمالي المتبقّي عليك (ر.س)</p>
            <p className={`mt-1 text-xl font-bold ${totalDue > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
              {halalasToSar(totalDue)}
            </p>
          </CardBody>
        </Card>
      </header>

      <Tabs
        items={[
          { id: "contracts", label: `العقود والاستحقاقات (${contracts.length})`, content: contractsTab },
          { id: "payments", label: `دفعاتي (${payments.length})`, content: paymentsTab },
          { id: "maintenance", label: `طلبات الصيانة (${requests.length})`, content: maintenanceTab },
        ]}
      />

      <p className="text-center text-[11px] text-slate-400">
        <Link href="/portal" className="hover:text-brand">← بوابتك</Link>
      </p>
    </div>
  );
}
