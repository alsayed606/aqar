"use client";

import { useState } from "react";
import { PropertyCard, propertyBucket, type PropertyCardData, type PropertyBucket } from "@/components/property-card";
import { FilterableCards } from "@/components/filterable-list";
import { StatusTabs, type StatusTab } from "@/components/status-tabs";
import { PROPERTY_KIND_AR } from "@/lib/labels";

// "Has vacancies" is the question the office opens this page with, and "no units" is the property
// someone started entering and left — which is also the only one that can still be deleted. So the
// tabs are not decoration: they are the two piles the list is actually sorted into.
const TABS: StatusTab<PropertyBucket>[] = [
  { id: "all", label: "الكل" },
  { id: "vacancy", label: "بها شواغر" },
  { id: "full", label: "مكتملة الإشغال" },
  { id: "empty", label: "بلا وحدات" },
];

export function PropertiesGrid({
  properties,
  canData,
}: {
  properties: PropertyCardData[];
  canData: boolean;
}) {
  const [tab, setTab] = useState<PropertyBucket | "all">("all");

  const counts = properties.reduce<Record<string, number>>((acc, p) => {
    const bucket = propertyBucket(p);
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});

  const shown = tab === "all" ? properties : properties.filter((p) => propertyBucket(p) === tab);

  return (
    <div className="space-y-3">
      <StatusTabs tabs={TABS} active={tab} counts={counts} total={properties.length} onSelect={setTab} />

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 dark:border-slate-700">
          لا توجد عقارات في هذا التصنيف.
        </p>
      ) : (
        <FilterableCards
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          placeholder="تصفية سريعة في هذه الصفحة… (الاسم أو المدينة أو الكود)"
          items={shown.map((property) => ({
            id: property.id,
            search: [property.name, property.city, property.district, property.property_code, PROPERTY_KIND_AR[property.property_kind]]
              .filter(Boolean)
              .join(" "),
            node: <PropertyCard property={property} canData={canData} />,
          }))}
        />
      )}
    </div>
  );
}
