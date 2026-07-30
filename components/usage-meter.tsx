// Usage against a plan ceiling, in one compact line. A number on its own ("40 units") says nothing
// about whether an office is about to hit a wall; the ratio is the whole signal, so the bar carries
// it and the colour names the urgency. A null limit is the Enterprise tier: unlimited, no bar to
// draw, and drawing an empty one would imply a ceiling that does not exist.
export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const ratio = limit && limit > 0 ? used / limit : 0;
  const tone =
    ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-brand";

  return (
    <div className="min-w-28">
      <div className="flex items-baseline justify-between gap-2 text-[11px] leading-tight">
        <span className="text-neutral-500">{label}</span>
        <span dir="ltr" className="tabular-nums text-neutral-700 dark:text-neutral-300">
          {used}
          {limit === null ? "" : ` / ${limit}`}
        </span>
      </div>
      {limit === null ? (
        <p className="mt-0.5 text-[10px] text-neutral-400">بلا حد</p>
      ) : (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
