"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/app/actions";

type NavLink = { href: string; label: string; badge?: number };
type NavGroup = { title: string; links: NavLink[] };

// Grouped so the mobile drawer reads in sections (mirrors the office mental model:
// portfolio → finance → administration). Desktop renders the same links inline.
function navGroups(unread: number): NavGroup[] {
  return [
    {
      title: "المحفظة",
      links: [
        { href: "/app", label: "الرئيسية" },
        { href: "/app/properties", label: "العقارات" },
        { href: "/app/units", label: "الوحدات" },
        { href: "/app/owners", label: "الملّاك" },
        { href: "/app/tenants", label: "المستأجرون" },
        { href: "/app/contracts", label: "العقود" },
      ],
    },
    {
      title: "المالية",
      links: [
        { href: "/app/invoices", label: "الفواتير" },
        { href: "/app/receipts", label: "السندات" },
        { href: "/app/subscription", label: "الاشتراك" },
      ],
    },
    {
      title: "الإدارة",
      links: [
        { href: "/app/import", label: "الاستيراد" },
        { href: "/app/team", label: "الفريق" },
        { href: "/app/notifications", label: "الإشعارات", badge: unread },
      ],
    },
  ];
}

// Home is an exact match (every /app route starts with "/app"); the rest match their subtree.
function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

function Badge({ count }: { count: number }) {
  return (
    <span className="mr-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppNav({ orgName, unread }: { orgName: string | null; unread: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const groups = navGroups(unread);
  const links = groups.flatMap((g) => g.links);

  return (
    <>
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-5">
          <Link href="/app" className="text-lg font-bold" onClick={() => setOpen(false)}>
            عقار
          </Link>
          <nav className="hidden gap-4 text-sm text-neutral-600 md:flex dark:text-neutral-300">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={
                  "relative " +
                  (isActive(pathname, l.href) ? "font-medium text-brand" : "hover:text-brand")
                }
              >
                {l.label}
                {l.badge ? <Badge count={l.badge} /> : null}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {orgName && <span className="hidden text-sm text-neutral-500 sm:inline">{orgName}</span>}
          <form action={signOut} className="hidden md:block">
            <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              خروج
            </button>
          </form>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
            aria-expanded={open}
            className="rounded-lg border border-neutral-300 p-2 md:hidden dark:border-neutral-700"
          >
            {open ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <nav className="border-t border-neutral-200 px-4 py-3 md:hidden dark:border-neutral-800">
          {orgName && <p className="mb-2 text-xs text-neutral-500">{orgName}</p>}
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.title}>
                <p className="mb-1 text-xs font-semibold text-neutral-400">{g.title}</p>
                <ul className="space-y-0.5">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className={
                          "flex items-center rounded-lg px-2 py-2 text-sm " +
                          (isActive(pathname, l.href)
                            ? "bg-brand/10 font-medium text-brand"
                            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800")
                        }
                      >
                        {l.label}
                        {l.badge ? <Badge count={l.badge} /> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <form action={signOut} className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <button className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              خروج
            </button>
          </form>
        </nav>
      )}
    </>
  );
}
