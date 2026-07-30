import type { ReactNode } from "react";

// One KPI. `hint` carries the comparison or the caveat — a number with no reference point ("MRR
// 29,900") tells an executive almost nothing; "up from 19,900 last month" tells them everything.
//
// `unavailable` renders the tile as explicitly not measured yet. The alternative — showing 0 — reads
// as a measured zero, which is a different and much worse claim.
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  unavailable,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  unavailable?: boolean;
}) {
  const valueTone =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : tone === "bad" ? "text-red-600 dark:text-red-400"
    : "text-slate-900 dark:text-white";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500">{label}</p>
      {unavailable ? (
        <>
          <p className="mt-1 text-lg font-medium text-slate-400">—</p>
          <p className="mt-0.5 text-[11px] text-slate-400">غير مُقاس بعد</p>
        </>
      ) : (
        <>
          <p className={"mt-1 text-2xl font-bold tabular-nums " + valueTone} dir="ltr">
            {value}
          </p>
          {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
        </>
      )}
    </div>
  );
}
