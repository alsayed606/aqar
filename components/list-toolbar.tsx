// Search box for list pages. A plain GET form (no client JS): submitting sets ?q= and resets to
// page 1 (the page param is intentionally omitted). Rendered as a server component.
// `keep` carries the page's other URL filters through the submit — a GET form replaces the whole
// query string, so anything not re-posted here would be silently cleared by searching.
export function ListToolbar({
  q,
  placeholder,
  keep,
}: {
  q: string;
  placeholder: string;
  keep?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" className="flex items-center gap-2">
      {Object.entries(keep ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <input
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="w-full max-w-xs rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
      />
      <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
        بحث
      </button>
      {q && (
        <a href="?" className="text-sm text-neutral-500 hover:text-brand">
          مسح
        </a>
      )}
    </form>
  );
}
