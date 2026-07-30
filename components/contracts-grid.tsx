"use client";

import { useState } from "react";
import { ContractCard, contractBucket, type ContractCardData, type ContractBucket } from "@/components/contract-card";
import { FilterableCards } from "@/components/filterable-list";
import { cx } from "@/lib/cx";

const TABS: { id: "all" | ContractBucket; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "active", label: "نشط" },
  { id: "ending", label: "ينتهي قريباً" },
  { id: "ended", label: "منتهي" },
];

// Status tabs on top of the shared instant text filter, rendering the cards in a responsive grid.
export function ContractsGrid({ contracts }: { contracts: ContractCardData[] }) {
  const [tab, setTab] = useState<"all" | ContractBucket>("all");

  const counts = contracts.reduce<Record<string, number>>((acc, contract) => {
    const bucket = contractBucket(contract);
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});

  const shown = tab === "all" ? contracts : contracts.filter((c) => contractBucket(c) === tab);

  return (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => {
          const selected = t.id === tab;
          const count = t.id === "all" ? contracts.length : counts[t.id] ?? 0;
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
          لا توجد عقود في هذا التصنيف.
        </p>
      ) : (
        <FilterableCards
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          placeholder="تصفية سريعة في هذه الصفحة…"
          items={shown.map((contract) => ({
            id: contract.id,
            search: [contract.contract_number, contract.tenant_name, contract.property_name, contract.unit_number]
              .filter(Boolean)
              .join(" "),
            node: <ContractCard contract={contract} />,
          }))}
        />
      )}
    </div>
  );
}
