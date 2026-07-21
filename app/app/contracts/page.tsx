import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { ContractForm } from "@/components/contract-form";
import { CONTRACT_STATUS_AR, CONTRACT_STATUS_TONE } from "@/lib/labels";
import { halalasToSar } from "@/lib/money";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
function first(x: any) {
  return Array.isArray(x) ? x[0] : x;
}

export default async function ContractsPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const [{ data: unitData }, { data: tenantData }, { data: contractData, error }] =
    await Promise.all([
      supabase
        .from("unit")
        .select("id, unit_number, property:property_id(name)")
        .is("deleted_at", null)
        .order("unit_number"),
      supabase
        .from("tenant")
        .select("id, party:party_id(display_name)")
        .is("deleted_at", null),
      supabase
        .from("contract")
        .select(
          "id, contract_number, status, annual_rent_halalas, start_date, end_date, unit:unit_id(unit_number, property:property_id(name)), tenant:tenant_id(party:party_id(display_name))",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ]);

  const units = (unitData ?? []).map((u: any) => ({
    id: u.id,
    label: `${first(u.property)?.name ?? "عقار"} — وحدة ${u.unit_number}`,
  }));
  const tenants = (tenantData ?? []).map((t: any) => ({
    id: t.id,
    label: first(t.party)?.display_name ?? "مستأجر",
  }));
  const contracts = contractData ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">العقود</h1>
        <span className="text-sm text-neutral-500">{contracts.length} عقد</span>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-base font-semibold">عقد جديد</h2>
        <p className="mb-4 text-sm text-neutral-500">
          يُنشأ كمسودة، ثم فعّله لتوليد جدول الاستحقاقات تلقائياً.
        </p>
        {units.length === 0 || tenants.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            تحتاج إلى{" "}
            {units.length === 0 && (
              <Link href="/app/properties" className="underline">
                إضافة وحدة
              </Link>
            )}
            {units.length === 0 && tenants.length === 0 && " و"}
            {tenants.length === 0 && (
              <Link href="/app/tenants" className="underline">
                إضافة مستأجر
              </Link>
            )}{" "}
            قبل إنشاء عقد.
          </p>
        ) : (
          <ContractForm units={units} tenants={tenants} />
        )}
      </section>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل العقود: {error.message}
        </p>
      ) : contracts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد عقود بعد.
        </p>
      ) : (
        <ul className="space-y-3">
          {contracts.map((c: any) => {
            const unit = first(c.unit);
            const tenant = first(c.tenant);
            return (
              <li key={c.id}>
                <Link
                  href={`/app/contracts/${c.id}`}
                  className="block rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-brand dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold" dir="ltr">
                      {c.contract_number}
                    </p>
                    <span
                      className={
                        "rounded-full px-2.5 py-0.5 text-xs font-medium " +
                        (CONTRACT_STATUS_TONE[c.status] ?? "")
                      }
                    >
                      {CONTRACT_STATUS_AR[c.status] ?? c.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                    {first(unit?.property)?.name ?? "—"} · وحدة {unit?.unit_number ?? "—"} ·{" "}
                    {first(tenant?.party)?.display_name ?? "—"}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    الإيجار السنوي: {halalasToSar(c.annual_rent_halalas)} ر.س ·{" "}
                    <span dir="ltr">
                      {c.start_date} → {c.end_date}
                    </span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
