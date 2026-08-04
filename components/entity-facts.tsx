import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * The identifiers block of a 360 header (§6.1): the record stated as facts, not as inputs.
 *
 * A missing value renders as an em dash rather than being hidden, because on an incomplete record
 * the gap is the useful information — it tells the office what still has to be collected.
 */
export function Fact({
  label,
  value,
  ltr,
}: {
  label: string;
  value?: ReactNode;
  /** For identifiers, IBANs, phone numbers and dates: a left-to-right run inside an Arabic page. */
  ltr?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        dir={ltr && !empty ? "ltr" : undefined}
        className={cx(
          "text-sm",
          ltr && !empty && "text-start",
          empty ? "text-slate-400" : "text-slate-800 dark:text-slate-200",
        )}
      >
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

export function FactGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
      {children}
    </dl>
  );
}
