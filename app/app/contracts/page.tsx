import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { ContractForm } from "@/components/contract-form";
import { parseListParams, likePattern } from "@/lib/list-params";
import { LIST_SPECS, resolveSort, applySort } from "@/lib/list-specs";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FormDrawer } from "@/components/form-drawer";
import { ContractsGrid } from "@/components/contracts-grid";
import type { ContractCardData } from "@/components/contract-card";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; unit?: string; tenant?: string; property?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to, sort } = parseListParams(await searchParams);
  const sortOption = resolveSort(LIST_SPECS.contracts, sort);
  const { unit: presetUnitId, tenant: tenantFilter, property: propertyFilter } = await searchParams;

  const supabase = await createClient();

  let contractQuery = supabase
    .from("contract")
    .select(
      "id, contract_number, status, annual_rent_halalas, start_date, end_date, property_id, tenant_id, unit:unit_id(unit_number, property:property_id(name)), tenant:tenant_id(party:party_id(display_name))",
      { count: "exact" },
    )
    .is("deleted_at", null);
  if (q) contractQuery = contractQuery.ilike("contract_number", likePattern(q));
  // Deep link from a tenant 360 page: show only that tenant's contracts (§6.1).
  if (tenantFilter) contractQuery = contractQuery.eq("tenant_id", tenantFilter);
  if (propertyFilter) contractQuery = contractQuery.eq("property_id", propertyFilter);

  const [{ data: unitData }, { data: tenantData }, { data: contractData, error, count }] =
    await Promise.all([
      // current_status drives the form's default: a new contract offers the units that can take one.
      // The occupied and out-of-service ones stay reachable behind a toggle rather than disappearing.
      supabase
        .from("unit")
        .select("id, unit_number, current_status, property:property_id(name)")
        .is("deleted_at", null)
        .order("unit_number"),
      // entity_type and the brand list drive the commercial block in the contract form: an
      // individual renting a flat should never be asked for a shop name or a signing representative.
      supabase
        .from("tenant")
        .select("id, party:party_id(display_name, entity_type, rep_name, rep_capacity, rep_id_number, rep_phone_raw, trade_name(id, name))")
        .is("deleted_at", null),
      applySort(contractQuery, sortOption).range(from, to),
    ]);

  const units = (unitData ?? []).map((u: any) => ({
    id: u.id,
    label: `${first(u.property)?.name ?? "عقار"} — وحدة ${u.unit_number}`,
    status: u.current_status as string,
  }));
  const tenants = (tenantData ?? []).map((t: any) => {
    const party = first(t.party);
    return {
      id: t.id,
      label: party?.display_name ?? "مستأجر",
      entity_type: party?.entity_type ?? "individual",
      rep_name: party?.rep_name ?? null,
      rep_capacity: party?.rep_capacity ?? null,
      rep_id_number: party?.rep_id_number ?? null,
      rep_phone: party?.rep_phone_raw ?? null,
      brands: (party?.trade_name ?? []).map((b: any) => ({ id: b.id, name: b.name })),
    };
  });
  const total = count ?? 0;
  // Flatten the embedded relations into the plain shape the client grid expects.
  const contracts: ContractCardData[] = (contractData ?? []).map((c: any) => {
    const unit = first(c.unit);
    return {
      id: c.id,
      contract_number: c.contract_number,
      status: c.status,
      start_date: c.start_date,
      end_date: c.end_date,
      annual_rent_halalas: Number(c.annual_rent_halalas),
      unit_number: unit?.unit_number ?? null,
      property_name: first(unit?.property)?.name ?? null,
      property_id: c.property_id ?? null,
      tenant_name: first(first(c.tenant)?.party)?.display_name ?? null,
      tenant_id: c.tenant_id ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">العقود</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{total} عقد</span>
          <FormDrawer label="عقد جديد" title="عقد جديد (مسودة)">
            <p className="mb-4 text-sm text-neutral-500">يُنشأ كمسودة، ثم فعّله لتوليد جدول الاستحقاقات تلقائياً.</p>
            {units.length === 0 || tenants.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                تحتاج إلى{" "}
                {units.length === 0 && <Link href="/app/properties" className="underline">إضافة وحدة</Link>}
                {units.length === 0 && tenants.length === 0 && " و"}
                {tenants.length === 0 && <Link href="/app/tenants" className="underline">إضافة مستأجر</Link>}{" "}
                قبل إنشاء عقد.
              </p>
            ) : (
              <ContractForm units={units} tenants={tenants} defaultUnitId={presetUnitId ?? ""} />
            )}
          </FormDrawer>
        </div>
      </div>

      <ListToolbar q={q} placeholder="بحث برقم العقد…" keep={{ unit: presetUnitId, tenant: tenantFilter, property: propertyFilter }} resource="contracts" sort={sortOption.key} />

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل العقود: {error.message}
        </p>
      ) : contracts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا توجد عقود بعد."}
        </p>
      ) : (
        <>
          <ContractsGrid contracts={contracts} />
          <Pagination page={page} total={total} q={q} basePath="/app/contracts" params={{ sort: sortOption.key, tenant: tenantFilter, property: propertyFilter }} />
        </>
      )}
    </div>
  );
}
