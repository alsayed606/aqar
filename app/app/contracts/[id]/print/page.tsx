import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { tafqitSar } from "@/lib/tafqit";
import { CONTRACT_STATUS_AR, FREQUENCY_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";
import { first } from "@/lib/rows";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 border-b border-dashed border-neutral-200 py-2 dark:border-neutral-700">
      <span className="w-36 shrink-0 text-sm text-neutral-500">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export default async function ContractPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("contract")
    .select(
      "id, org_id, contract_number, status, contract_kind, payment_frequency, start_date, end_date, annual_rent_halalas, deposit_halalas, service_fees_halalas, deed_number, trade_name, representative_name, representative_capacity, representative_phone, ejar_contract_number, ejar_broker_office, ejar_broker_number, ejar_broker_representative, ejar_has_extra_terms, unit:unit_id(unit_number, property:property_id(name, city, district)), tenant:tenant_id(party:party_id(display_name, national_id, phone_e164))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!contract) notFound();

  const { data: org } = await supabase
    .from("organization")
    .select("name, cr_number, vat_number")
    .eq("id", contract.org_id)
    .maybeSingle();

  const unit = first((contract as any).unit);
  const property = first(unit?.property);
  const tenant = first(first((contract as any).tenant)?.party);
  const annual = Number(contract.annual_rent_halalas);

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <nav className="text-sm text-neutral-500">
          <Link href="/app/contracts" className="hover:text-brand">العقود</Link> /{" "}
          <Link href={`/app/contracts/${contract.id}`} className="hover:text-brand" dir="ltr">{contract.contract_number}</Link>
        </nav>
        <PrintButton label="طباعة العقد" />
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
            <h2 className="text-xl font-extrabold text-brand">عقد إيجار</h2>
            <p className="mt-1 text-xs text-neutral-500">Lease Contract</p>
          </div>
        </header>

        <div className="mb-4 flex justify-between text-sm">
          <span>رقم العقد: <span className="font-mono font-bold" dir="ltr">{contract.contract_number}</span></span>
          <span>الحالة: {CONTRACT_STATUS_AR[contract.status] ?? contract.status}</span>
        </div>

        <section className="space-y-1">
          <p className="mt-2 mb-1 text-xs font-semibold text-neutral-500">أطراف العقد والعين المؤجرة</p>
          <Row label="المستأجر">{tenant?.display_name ?? "—"}</Row>
          {tenant?.national_id && <Row label="هوية المستأجر"><span dir="ltr">{tenant.national_id}</span></Row>}
          {tenant?.phone_e164 && <Row label="جوال المستأجر"><span dir="ltr">{tenant.phone_e164}</span></Row>}
          {contract.trade_name && <Row label="اسم المحل التجاري">{contract.trade_name}</Row>}
          {contract.representative_name && (
            <Row label="ممثل المنشأة">
              {contract.representative_name}
              {contract.representative_capacity ? ` — ${contract.representative_capacity}` : ""}
            </Row>
          )}
          <Row label="العقار">
            {property?.name ?? "—"}
            {[property?.city, property?.district].filter(Boolean).length > 0 && (
              <span className="text-neutral-500"> — {[property?.city, property?.district].filter(Boolean).join(" · ")}</span>
            )}
          </Row>
          <Row label="الوحدة">{unit?.unit_number ?? "—"}</Row>
          {contract.deed_number && <Row label="رقم الصك"><span dir="ltr">{contract.deed_number}</span></Row>}

          <p className="mt-4 mb-1 text-xs font-semibold text-neutral-500">المدة والقيمة</p>
          <Row label="مدة العقد"><span dir="ltr">{contract.start_date} → {contract.end_date}</span></Row>
          <Row label="نوع العقد">{contract.contract_kind === "commercial" ? "تجاري" : "سكني"}</Row>
          <Row label="دورية الدفع">{FREQUENCY_AR[contract.payment_frequency] ?? contract.payment_frequency}</Row>
          <Row label="الإيجار السنوي"><span className="font-bold">{halalasToSar(annual)} ر.س</span></Row>
          <Row label="فقط">{tafqitSar(annual)}</Row>
          {Number(contract.deposit_halalas) > 0 && <Row label="التأمين">{halalasToSar(contract.deposit_halalas)} ر.س</Row>}
          {Number(contract.service_fees_halalas) > 0 && <Row label="رسوم الخدمات">{halalasToSar(contract.service_fees_halalas)} ر.س</Row>}

          {(contract.ejar_contract_number || contract.ejar_broker_office || contract.ejar_has_extra_terms != null) && (
            <>
              <p className="mt-4 mb-1 text-xs font-semibold text-neutral-500">بيانات منصة إيجار</p>
              {contract.ejar_contract_number && (
                <Row label="رقم العقد في إيجار"><span dir="ltr">{contract.ejar_contract_number}</span></Row>
              )}
              {contract.ejar_broker_office && (
                <Row label="مكتب الوساطة">
                  {contract.ejar_broker_office}
                  {contract.ejar_broker_number ? ` — ${contract.ejar_broker_number}` : ""}
                </Row>
              )}
              {contract.ejar_broker_representative && <Row label="ممثل المكتب">{contract.ejar_broker_representative}</Row>}
              {contract.ejar_has_extra_terms != null && (
                <Row label="بنود إضافية في عقد إيجار">{contract.ejar_has_extra_terms ? "نعم" : "لا"}</Row>
              )}
            </>
          )}
        </section>

        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-sm">
          <div>
            <p className="text-neutral-500">المؤجِّر / وكيله</p>
            <div className="mt-10 border-t border-neutral-300 dark:border-neutral-600" />
          </div>
          <div>
            <p className="text-neutral-500">المستأجر</p>
            <div className="mt-10 border-t border-neutral-300 dark:border-neutral-600" />
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-neutral-400">
          هذه نسخة مطبوعة من سجلّ النظام لأغراض الاطلاع والتوثيق الداخلي.
        </p>
      </article>
    </div>
  );
}
