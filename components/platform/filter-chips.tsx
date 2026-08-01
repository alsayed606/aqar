import Link from "next/link";

// A row of one-parameter filter chips for a server-rendered list.
//
// The knowledge this holds is not the styling — it is that changing ONE filter must carry the
// page's OTHER filters through the URL. Three pages each rebuilt that href by hand and the third
// copy had already drifted, which is how a filter silently clears itself when you touch another.
//
// An empty `value` is the "all" chip: absent from the URL rather than present-and-empty, so the
// unfiltered page has one canonical address.

export type FilterChip = { value: string; label: string; hint?: string | number };

export function FilterChips({
  basePath,
  param,
  options,
  active,
  keep,
}: {
  basePath: string;
  param: string;
  options: FilterChip[];
  active: string;
  keep?: Record<string, string | undefined>;
}) {
  const href = (value: string) => {
    const params = new URLSearchParams();
    for (const [key, carried] of Object.entries(keep ?? {})) if (carried) params.set(key, carried);
    if (value) params.set(param, value);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Link
          key={option.value || "all"}
          href={href(option.value)}
          className={
            "rounded-full border px-3 py-1 text-xs transition-colors " +
            (active === option.value
              ? "border-brand bg-brand text-white"
              : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800")
          }
        >
          {option.label}
          {option.hint !== undefined && <span className="ms-1 opacity-60">{option.hint}</span>}
        </Link>
      ))}
    </div>
  );
}
