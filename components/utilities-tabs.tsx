"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";

// Sections of the utilities module. Reports arrive in U-4 and are listed only once they exist — a
// tab that leads nowhere is worse than no tab.
const TABS = [
  { href: "/app/utilities", label: "العدادات" },
  { href: "/app/utilities/readings", label: "القراءات" },
  { href: "/app/utilities/bills", label: "الفواتير" },
];

export function UtilitiesTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {TABS.map((t) => {
        const active = t.href === "/app/utilities" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-brand font-medium text-brand"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
