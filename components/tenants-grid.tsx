"use client";

import { useState } from "react";
import { TenantCard, tenantBucket, type TenantCardData, type TenantBucket } from "@/components/tenant-card";
import { FilterableCards } from "@/components/filterable-list";
import { StatusTabs, type StatusTab } from "@/components/status-tabs";

const TABS: StatusTab<TenantBucket>[] = [
  { id: "all", label: "الكل" },
  { id: "individual", label: "أفراد" },
  { id: "sole_establishment", label: "مؤسسات فردية" },
  { id: "company", label: "شركات" },
];

export function TenantsGrid({ tenants }: { tenants: TenantCardData[] }) {
  const [tab, setTab] = useState<TenantBucket | "all">("all");

  const counts = tenants.reduce<Record<string, number>>((acc, tenant) => {
    const bucket = tenantBucket(tenant);
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});

  const shown = tab === "all" ? tenants : tenants.filter((t) => tenantBucket(t) === tab);

  return (
    <div className="space-y-3">
      <StatusTabs tabs={TABS} active={tab} counts={counts} total={tenants.length} onSelect={setTab} />

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 dark:border-slate-700">
          لا يوجد مستأجرون في هذا التصنيف.
        </p>
      ) : (
        <FilterableCards
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          placeholder="تصفية المستأجرين… (الاسم أو الهوية أو الجوال)"
          items={shown.map((tenant) => ({
            id: tenant.id,
            search: [tenant.display_name, tenant.primary_id, tenant.phone_e164, ...tenant.units].filter(Boolean).join(" "),
            node: <TenantCard tenant={tenant} />,
          }))}
        />
      )}
    </div>
  );
}
