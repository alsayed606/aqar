import Link from "next/link";

export type SummaryStat = {
  label: string;
  value: string | number;
  /** Where this number came from, filtered to this entity. Omit only when nothing can be linked. */
  href?: string;
  hint?: string;
};

/**
 * The summary row of a 360 page (§6.1). Each card states a number and links OUT to the module that
 * owns it, filtered to this entity.
 *
 * The linking is the point, not decoration: a 360 page that re-implements the contracts table
 * becomes a second copy to maintain and will drift from the real one. Showing the count and handing
 * off keeps one implementation of every list.
 */
export function EntitySummary({ stats }: { stats: SummaryStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => {
        const inner = (
          <>
            {/* A money figure is long enough to wrap inside a quarter-width card, which pushed the
                label and the link out of line with the neighbouring cards. Currency belongs in the
                label — the convention the dashboard cards already use ("المتأخرات (ر.س)"). */}
            <div className="truncate text-2xl font-bold text-slate-900 dark:text-white" title={String(stat.value)}>
              {stat.value}
            </div>
            <div className="text-xs text-slate-500">{stat.label}</div>
            {stat.hint && <div className="mt-0.5 text-[11px] text-slate-500">{stat.hint}</div>}
          </>
        );
        const base = "rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900";

        return stat.href ? (
          <Link
            key={stat.label}
            href={stat.href}
            className={`${base} shadow-card transition-all hover:border-brand hover:shadow-card-hover dark:shadow-none`}
          >
            {inner}
            <div className="mt-1 text-[11px] text-brand">عرض ←</div>
          </Link>
        ) : (
          <div key={stat.label} className={base}>{inner}</div>
        );
      })}
    </div>
  );
}
