"use client";

import { useState } from "react";
import { UnitCard, unitBucket, type UnitCardData, type UnitBucket } from "@/components/unit-card";
import { FilterableCards } from "@/components/filterable-list";
import { UNIT_STATUS_AR } from "@/lib/labels";
import { cx } from "@/lib/cx";

// `other` keeps reserved / not-rentable / out-of-service reachable — the unit_status enum has six
// values, so a three-tab bar would silently hide units.
const TABS: { id: "all" | UnitBucket; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "vacant", label: "الشاغرة" },
  { id: "rented", label: "المؤجرة" },
  { id: "maintenance", label: "تحت الصيانة" },
  { id: "other", label: "أخرى" },
];

export function UnitsGrid({ units, canData }: { units: UnitCardData[]; canData: boolean }) {
  const [tab, setTab] = useState<"all" | UnitBucket>("all");

  const counts = units.reduce<Record<string, number>>((acc, unit) => {
    const bucket = unitBucket(unit.current_status);
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});

  const shown = tab === "all" ? units : units.filter((u) => unitBucket(u.current_status) === tab);

  return (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => {
          const selected = t.id === tab;
          const count = t.id === "all" ? units.length : counts[t.id] ?? 0;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className={cx(
                "relative -mb-px whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
                selected ? "text-brand" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
              )}
            >
              {t.label} <span className="text-xs text-slate-400">({count})</span>
              {selected && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand" />}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 dark:border-slate-700">
          لا توجد وحدات في هذا التصنيف.
        </p>
      ) : (
        <FilterableCards
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          placeholder="تصفية الوحدات… (رقم الوحدة أو العقار أو المستأجر)"
          items={shown.map((unit) => ({
            id: unit.id,
            search: [unit.unit_number, unit.property_name, unit.tenant_name, UNIT_STATUS_AR[unit.current_status]]
              .filter(Boolean)
              .join(" "),
            node: <UnitCard unit={unit} canData={canData} />,
          }))}
        />
      )}
    </div>
  );
}
