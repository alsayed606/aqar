"use client";

import { cx } from "@/lib/cx";

export type StatusTab<T extends string> = { id: T | "all"; label: string };

// Shared filter bar for the card grids (contracts / units / owners / tenants).
export function StatusTabs<T extends string>({
  tabs,
  active,
  counts,
  total,
  onSelect,
}: {
  tabs: StatusTab<T>[];
  active: T | "all";
  counts: Record<string, number>;
  total: number;
  onSelect: (id: T | "all") => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const count = tab.id === "all" ? total : counts[tab.id] ?? 0;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cx(
              "relative -mb-px whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
              selected ? "text-brand" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {tab.label} <span className="text-xs text-slate-400">({count})</span>
            {selected && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand" />}
          </button>
        );
      })}
    </div>
  );
}
