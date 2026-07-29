"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

// Instant client-side filtering over the already-loaded page rows (complements the server-side
// search which spans the whole dataset). Cells/nodes are pre-rendered on the server and passed
// as slots, so links and Server-Action forms keep working across the RSC boundary.

function FilterInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-transparent py-2 pr-9 pl-3 text-sm outline-none focus:border-brand dark:border-slate-700"
      />
    </div>
  );
}

function Count({ shown, total }: { shown: number; total: number }) {
  return <p className="text-xs text-slate-500">عرض {shown} من {total}</p>;
}

export type TableRow = { id: string; search: string; cells: ReactNode };

export function FilterableTable({
  headers,
  rows,
  placeholder = "تصفية سريعة…",
  empty = "لا نتائج مطابقة للتصفية.",
}: {
  headers: ReactNode;
  rows: TableRow[];
  placeholder?: string;
  empty?: string;
}) {
  const [q, setQ] = useState("");
  const n = q.trim().toLowerCase();
  const shown = n ? rows.filter((r) => r.search.toLowerCase().includes(n)) : rows;

  return (
    <div className="space-y-3">
      <FilterInput value={q} onChange={setQ} placeholder={placeholder} />
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 dark:border-slate-700">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">{headers}</thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  {r.cells}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {n && <Count shown={shown.length} total={rows.length} />}
    </div>
  );
}

export type CardItem = { id: string; search: string; node: ReactNode };

export function FilterableCards({
  items,
  placeholder = "تصفية سريعة…",
  className = "space-y-2",
  empty = "لا نتائج مطابقة للتصفية.",
}: {
  items: CardItem[];
  placeholder?: string;
  className?: string;
  empty?: string;
}) {
  const [q, setQ] = useState("");
  const n = q.trim().toLowerCase();
  const shown = n ? items.filter((it) => it.search.toLowerCase().includes(n)) : items;

  return (
    <div className="space-y-3">
      <FilterInput value={q} onChange={setQ} placeholder={placeholder} />
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 dark:border-slate-700">{empty}</p>
      ) : (
        <div className={cx(className)}>
          {shown.map((it) => (
            <div key={it.id}>{it.node}</div>
          ))}
        </div>
      )}
      {n && <Count shown={shown.length} total={items.length} />}
    </div>
  );
}
