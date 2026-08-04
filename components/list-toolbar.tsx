import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { LIST_SPECS } from "@/lib/list-specs";

// Search, sort and export for list pages. A plain GET form (no client JS beyond the select's
// auto-submit): submitting sets ?q= and ?sort= and resets to page 1 (the page param is
// intentionally omitted).
// `keep` carries the page's other URL filters through the submit — a GET form replaces the whole
// query string, so anything not re-posted here would be silently cleared by searching.
//
// Laid out for a phone first: the search box takes the full width on its own row and the controls
// wrap beneath it, rather than three shrunken controls fighting over one line.

const control =
  "rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-slate-700";

export function ListToolbar({
  q,
  placeholder,
  keep,
  resource,
  sort,
}: {
  q: string;
  placeholder: string;
  keep?: Record<string, string | undefined>;
  /** Enables the sort control and the export link. Omit on a list that has no spec yet. */
  resource?: keyof typeof LIST_SPECS;
  sort?: string;
}) {
  const spec = resource ? LIST_SPECS[resource] : undefined;

  // The export carries the filters currently in the URL, so the file matches the screen.
  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (sort) exportParams.set("sort", sort);
  const exportHref = `/api/export/${resource}${exportParams.toString() ? `?${exportParams}` : ""}`;

  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      {Object.entries(keep ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}

      <input
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className={`${control} w-full sm:w-auto sm:max-w-xs sm:flex-1`}
      />

      <button className={`${control} hover:bg-slate-100 dark:hover:bg-slate-800`}>بحث</button>

      {spec && (
        <AutoSubmitSelect
          name="sort"
          value={sort ?? spec.sorts[0].key}
          label="ترتيب القائمة"
          options={spec.sorts.map((s) => ({ value: s.key, label: s.label }))}
          className={control}
        />
      )}

      {q && (
        <a href="?" className="text-sm text-slate-500 hover:text-brand">مسح</a>
      )}

      {spec && (
        <a
          href={exportHref}
          // Not a form submit: the export must not clear the sort select or re-run the search.
          className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          title={`تصدير ${spec.label} المعروضة إلى Excel`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M12 15V3M7 10l5 5 5-5" />
          </svg>
          تصدير
        </a>
      )}
    </form>
  );
}
