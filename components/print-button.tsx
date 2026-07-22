"use client";

/** A print trigger that is itself hidden on paper (via the `no-print` class). */
export function PrintButton({ label = "طباعة" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg"
    >
      {label}
    </button>
  );
}
