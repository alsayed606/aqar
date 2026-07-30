import Link from "next/link";
import { PAGE_SIZE } from "@/lib/list-params";

// Prev/next pager for list pages. Preserves the current search query — and any other filter the
// page keeps in the URL, via `params`, so paging never silently drops a filter the user set.
// Hidden when a single page.
export function Pagination({
  page,
  total,
  q,
  basePath,
  params,
}: {
  page: number;
  total: number;
  q: string;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    for (const [key, value] of Object.entries(params ?? {})) if (value) sp.set(key, value);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  if (pages <= 1) {
    return <p className="text-xs text-neutral-400">{total} نتيجة</p>;
  }
  const btn =
    "rounded-lg border border-neutral-300 px-3 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";
  return (
    <div className="flex items-center justify-between text-sm text-neutral-500">
      <span>صفحة {page} من {pages} · {total} نتيجة</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={href(page - 1)} className={btn}>السابق</Link>}
        {page < pages && <Link href={href(page + 1)} className={btn}>التالي</Link>}
      </div>
    </div>
  );
}
