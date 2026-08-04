// Shared parsing for searchable/paginated list pages. Keeps page size + range math in one place.
export const PAGE_SIZE = 20;

export function parseListParams(sp: { q?: string; page?: string; sort?: string }) {
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  // Passed through raw; `resolveSort` in lib/list-specs.ts is what validates it against the list's
  // own whitelist, so an unknown or hostile value can never reach a query.
  const sort = (sp.sort ?? "").trim();
  return { q, page, from, to, sort };
}

// A PostgREST-safe ilike pattern: escape %, _ and \ so user input can't act as wildcards.
export function likePattern(q: string): string {
  return "%" + q.replace(/([\\%_])/g, "\\$1") + "%";
}

export function pageCountOf(total: number | null | undefined): number {
  return Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
}
