import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { halalasToSar } from "@/lib/money";
import {
  CONTRACT_STATUS_AR,
  PAYMENT_METHOD_AR,
  MAINTENANCE_CATEGORY_AR,
  MAINTENANCE_URGENCY_AR,
  MAINTENANCE_STATUS_AR,
} from "@/lib/labels";
import { Badge } from "@/components/ui";
import { MaintenanceRequestForm, type PortalUnit } from "@/components/maintenance-request-form";
import { isMaintenanceOpen, maintenanceStatusTone } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

// The tenant's screen, written for the phone it is read on.
//
// It used to open with three tabs of office tables — contracts, payments, maintenance — each one a
// five-column grid scrolling sideways. But a tenant arrives with one of two questions: "what do I
// owe and when", or "something is broken". Everything else is reference material they open once.
//
// So the page answers those two above the fold and puts the rest below, as rows that stack rather
// than tables that scroll. Tabs are gone: on a narrow screen they hide two thirds of a short page.

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

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Days from today to a due date — negative once it has passed. */
function daysUntil(dueDate: string): number {
  const due = new Date(dueDate + "T00:00:00Z").getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((due - today) / 86_400_000);
}

/** "متأخرة ٣ أيام" / "بعد ١٢ يوماً" / "اليوم" — the phrase a tenant reads before the number. */
function whenAr(dueDate: string): string {
  const days = daysUntil(dueDate);
  if (days === 0) return "تستحق اليوم";
  if (days < 0) return `متأخرة ${Math.abs(days)} يوم`;
  return `بعد ${days} يوم`;
}

function chargeBadge(charge: Charge) {
  if (charge.is_settled) return <Badge tone="success">مدفوع</Badge>;
  if (charge.is_overdue) return <Badge tone="danger">متأخر</Badge>;
  return <Badge tone="warning">غير مدفوع</Badge>;
}

function Section({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
      {children}
    </p>
  );
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

  const totalDue = charges.reduce((sum, c) => sum + Number(c.balance_halalas), 0);
  const unsettled = charges.filter((c) => !c.is_settled).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  // The nearest unpaid instalment — overdue ones sort first because they are dated earlier.
  const next = unsettled[0] ?? null;
  const overdueCount = unsettled.filter((c) => c.is_overdue).length;

  const activeContracts = contracts.filter((c) => c.status === "active");
  const openRequests = requests.filter((r) => isMaintenanceOpen(r.status));

  const openUnits: PortalUnit[] = ((unitData ?? []) as PortalUnitRow[]).map((u) => ({
    unit_id: u.unit_id,
    label: `${u.property_name} — وحدة ${u.unit_number}`,
  }));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">{link.org_name}</p>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">{link.display_name}</h1>
      </header>

      {/* The one thing the tenant came for. Everything else on this page is reference. */}
      <section
        className={
          "rounded-2xl border p-5 " +
          (next
            ? next.is_overdue
              ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-900/20"
              : "border-brand/30 bg-brand/5 dark:border-brand/40 dark:bg-brand/10"
            : "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-900/20")
        }
      >
        {next ? (
          <>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">الدفعة القادمة</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tabular-nums" dir="ltr">{halalasToSar(next.balance_halalas)}</span>
              <span className="text-sm text-slate-600 dark:text-slate-300">ر.س</span>
            </p>
            <p className={"mt-1 text-sm font-medium " + (next.is_overdue ? "text-red-700 dark:text-red-300" : "text-slate-600 dark:text-slate-300")}>
              {whenAr(next.due_date)} — <span dir="ltr">{next.due_date}</span>
            </p>
            {(totalDue !== Number(next.balance_halalas) || overdueCount > 0) && (
              <p className="mt-3 border-t border-black/5 pt-2 text-xs text-slate-600 dark:border-white/10 dark:text-slate-300">
                إجمالي المتبقّي عليك <b dir="ltr">{halalasToSar(totalDue)}</b> ر.س
                {overdueCount > 0 && <> · منها <b>{overdueCount}</b> دفعة متأخرة</>}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-base font-bold text-emerald-800 dark:text-emerald-300">لا يوجد مستحق عليك.</p>
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">كل ما استُحقّ حتى الآن مسدَّد.</p>
          </>
        )}
      </section>

      {/* Reporting a fault is the second reason a tenant opens this page, so it is a button — not a
          tab, and not a form they must scroll past their contract to find. */}
      <div className="flex flex-wrap gap-2">
        <a
          href="#maintenance"
          className="flex-1 rounded-xl bg-brand px-4 py-3 text-center text-sm font-medium text-white hover:bg-brand-fg"
        >
          طلب صيانة
        </a>
        <a
          href="#payments"
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          سنداتي
        </a>
      </div>

      {/* Where I live, in one line per contract. */}
      <Section id="units" title={activeContracts.length > 1 ? "وحداتي" : "وحدتي"}>
        {contracts.length === 0 ? (
          <Empty>لا توجد عقود مسجّلة.</Empty>
        ) : (
          <ul className="space-y-2">
            {contracts.map((ct) => (
              <li
                key={ct.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">
                      {ct.property_name} — وحدة {ct.unit_number}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      عقد <span dir="ltr">{ct.contract_number}</span> · <span dir="ltr">{ct.start_date} → {ct.end_date}</span>
                    </p>
                  </div>
                  <Badge tone={ct.status === "active" ? "success" : "neutral"}>
                    {CONTRACT_STATUS_AR[ct.status] ?? ct.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  الإيجار السنوي <b dir="ltr">{halalasToSar(ct.annual_rent_halalas)}</b> ر.س
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Instalments as stacked rows: a five-column table on a phone is a table nobody reads. */}
      <Section id="charges" title="جدول الاستحقاقات">
        {charges.length === 0 ? (
          <Empty>لا توجد استحقاقات بعد.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {charges.map((c) => (
              <li key={c.charge_id} className="flex items-center justify-between gap-3 bg-white px-4 py-3 dark:bg-slate-900">
                <div className="min-w-0">
                  <p className="text-sm font-medium" dir="ltr">{c.due_date}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {c.is_settled ? (
                      <>سُدّد بالكامل</>
                    ) : (
                      <>
                        المتبقّي <b dir="ltr">{halalasToSar(c.balance_halalas)}</b> من{" "}
                        <span dir="ltr">{halalasToSar(c.gross_halalas)}</span> ر.س
                      </>
                    )}
                  </p>
                </div>
                {chargeBadge(c)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="payments" title="سنداتي">
        {payments.length === 0 ? (
          <Empty>لا توجد دفعات مسجّلة بعد.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 bg-white px-4 py-3 dark:bg-slate-900">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span dir="ltr">{halalasToSar(p.amount_halalas)}</span> ر.س
                    <span className="mr-2 text-xs font-normal text-slate-500">
                      {PAYMENT_METHOD_AR[p.method] ?? p.method}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <span dir="ltr">{day(p.received_at)}</span>
                    {p.receipt_no && <> · سند <span dir="ltr" className="font-mono">{p.receipt_no}</span></>}
                  </p>
                </div>
                <Link
                  href={`/portal/tenant/${tenantId}/receipt/${p.id}`}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  السند
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="maintenance"
        title="طلبات الصيانة"
        action={openRequests.length > 0 ? <span className="text-xs text-slate-500">{openRequests.length} قيد المتابعة</span> : null}
      >
        {requests.length > 0 && (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {requests.map((r) => (
              <li key={r.id} className="bg-white px-4 py-3 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {MAINTENANCE_CATEGORY_AR[r.category] ?? r.category}
                      {r.unit_number && <span className="mr-2 text-xs font-normal text-slate-500">وحدة {r.unit_number}</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{r.description}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      <span dir="ltr">{r.request_no ?? "—"}</span> · <span dir="ltr">{day(r.created_at)}</span>
                      {r.urgency !== "normal" && <> · {MAINTENANCE_URGENCY_AR[r.urgency] ?? r.urgency}</>}
                    </p>
                  </div>
                  <Badge tone={maintenanceStatusTone(r.status)}>
                    {MAINTENANCE_STATUS_AR[r.status] ?? r.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" open={requests.length === 0}>
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-brand">
            + طلب صيانة جديد
          </summary>
          <div className="border-t border-slate-100 p-4 dark:border-slate-800">
            <MaintenanceRequestForm tenantId={tenantId} units={openUnits} />
          </div>
        </details>
      </Section>

      <p className="pt-2 text-center text-[11px] text-slate-400">
        <Link href="/portal" className="hover:text-brand">← بوابتك</Link>
      </p>
    </div>
  );
}
