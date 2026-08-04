import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { TenantForm } from "@/components/tenant-form";
import { parseListParams, likePattern } from "@/lib/list-params";
import { LIST_SPECS, resolveSort, applySort } from "@/lib/list-specs";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FormDrawer } from "@/components/form-drawer";
import { TenantsGrid } from "@/components/tenants-grid";
import type { TenantCardData } from "@/components/tenant-card";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to, sort } = parseListParams(await searchParams);
  const sortOption = resolveSort(LIST_SPECS.tenants, sort);

  const supabase = await createClient();
  let query = supabase
    .from("tenant")
    .select(
      "id, tenant_type, party:party_id!inner(display_name, primary_id, phone_e164, identity_complete, rep_name)",
      { count: "exact" },
    )
    .is("deleted_at", null);
  // Search resolves on the primary identifier as well as the name, so "ابحث بالهوية أو بالرقم
  // الموحّد" works. Digits are stored unformatted, so a typed value is stripped to match.
  if (q) {
    const digits = q.replace(/\D/g, "");
    const terms = [
      `display_name.ilike.${likePattern(q)}`,
      `rep_name.ilike.${likePattern(q)}`,
      ...(digits ? [`primary_id.ilike.${likePattern(digits)}`, `phone_e164.ilike.${likePattern(digits)}`] : []),
    ];
    query = query.or(terms.join(","), { referencedTable: "party" });
  }
  // Active contracts drive the "N عقد نشط" block and the rented unit list on each card.
  const [{ data, error, count }, { data: contractData }] = await Promise.all([
    applySort(query, sortOption).range(from, to),
    supabase
      .from("contract")
      .select("tenant_id, unit:unit_id(unit_number, property:property_id(name))")
      .eq("status", "active")
      .is("deleted_at", null),
  ]);

  const total = count ?? 0;
  // Count every active contract, but only list units we can actually label.
  const activeByTenant = new Map<string, { count: number; units: string[] }>();
  for (const contract of contractData ?? []) {
    const unit = first((contract as any).unit);
    const label = [first(unit?.property)?.name, unit?.unit_number ? `وحدة ${unit.unit_number}` : null]
      .filter(Boolean)
      .join(" — ");
    const entry = activeByTenant.get(contract.tenant_id) ?? { count: 0, units: [] };
    entry.count += 1;
    if (label) entry.units.push(label);
    activeByTenant.set(contract.tenant_id, entry);
  }

  const tenants: TenantCardData[] = (data ?? []).map((t: any) => {
    const p = first(t.party);
    const active = activeByTenant.get(t.id);
    return {
      id: t.id,
      display_name: p?.display_name ?? "مستأجر",
      tenant_type: t.tenant_type ?? "individual",
      primary_id: p?.primary_id ?? null,
      identity_complete: p?.identity_complete !== false,
      phone_e164: p?.phone_e164 ?? null,
      active_contracts: active?.count ?? 0,
      units: active?.units ?? [],
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">المستأجرون</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{total} مستأجر</span>
          <FormDrawer label="إضافة مستأجر" title="إضافة مستأجر">
            <TenantForm />
          </FormDrawer>
        </div>
      </div>

      <ListToolbar q={q} placeholder="بحث بالاسم أو الهوية أو الرقم الموحّد أو الجوال…" resource="tenants" sort={sortOption.key} />

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل المستأجرين: {error.message}
        </p>
      ) : tenants.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا يوجد مستأجرون بعد. أضِف أول مستأجر من النموذج أعلاه."}
        </p>
      ) : (
        <>
          <TenantsGrid tenants={tenants} />
          <Pagination page={page} total={total} q={q} basePath="/app/tenants" params={{ sort: sortOption.key }} />
        </>
      )}
    </div>
  );
}
