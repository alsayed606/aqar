"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export type TabItem = { id: string; label: ReactNode; content: ReactNode };

export function Tabs({ items, initial, className }: { items: TabItem[]; initial?: string; className?: string }) {
  const [active, setActive] = useState(initial ?? items[0]?.id);
  const base = useId();

  function onKey(e: KeyboardEvent, idx: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowLeft" ? 1 : -1; // RTL: ArrowLeft moves to the next (visually left) tab.
    const next = (idx + dir + items.length) % items.length;
    setActive(items[next].id);
    document.getElementById(`${base}-tab-${items[next].id}`)?.focus();
  }

  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {items.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              id={`${base}-tab-${t.id}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cx(
                "relative -mb-px whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:text-brand",
                selected ? "text-brand" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
              )}
            >
              {t.label}
              {selected && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand" />}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div key={t.id} id={`${base}-panel-${t.id}`} role="tabpanel" hidden={t.id !== active} className="pt-4">
          {t.id === active && <div className="animate-fade-in">{t.content}</div>}
        </div>
      ))}
    </div>
  );
}
