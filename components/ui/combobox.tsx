"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "@/lib/cx";

export type ComboOption = { value: string; label: string; hint?: string };

// Searchable select. Emits a hidden input (name) so it works inside a <form> + Server Action.
// Server-side validation stays the source of truth (a hidden input can't enforce `required`).
export function Combobox({
  options,
  name,
  defaultValue = "",
  placeholder = "اختر…",
  emptyText = "لا نتائج",
  onChange,
  className,
}: {
  options: ComboOption[];
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  emptyText?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const [selected, setSelected] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === selected)?.label ?? "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(v: string) {
    setSelected(v);
    onChange?.(v);
    setOpen(false);
    setQuery("");
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[hi]) {
        e.preventDefault();
        choose(filtered[hi].value);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      {name && <input type="hidden" name={name} value={selected} />}
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={onKey}
        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700"
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full animate-fade-in overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">{emptyText}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === selected}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.value);
                }}
                onMouseEnter={() => setHi(i)}
                className={cx(
                  "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm",
                  i === hi ? "bg-brand/10 text-brand" : "text-slate-700 dark:text-slate-200",
                )}
              >
                <span>{o.label}</span>
                {o.hint && <span dir="ltr" className="text-xs text-slate-400">{o.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
