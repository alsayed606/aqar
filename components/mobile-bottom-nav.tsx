"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Thumb-level navigation for phones (§5.1). Office staff work from phones, so the three journeys
 * they repeat all day sit one tap away instead of behind a drawer that must be opened first.
 *
 * The destinations are chosen by frequency, not by taxonomy (§1.2): the dashboard they land on, the
 * contracts that carry tenant and rent, and the receipts they issue while standing in front of the
 * person paying. Everything else lives behind "المزيد", which opens the SAME drawer the desktop
 * sidebar uses — one menu, not a second copy that can drift.
 */

const ICONS: Record<string, ReactNode> = {
  home: <><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  receipt: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};

const TABS = [
  { href: "/app", label: "الرئيسية", icon: "home" },
  { href: "/app/contracts", label: "العقود", icon: "doc" },
  { href: "/app/receipts", label: "السندات", icon: "receipt" },
];

function Icon({ name, active }: { name: string; active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("transition-transform", active && "scale-110")}
    >
      {ICONS[name]}
    </svg>
  );
}

const tabClass = "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px]";

export function MobileBottomNav({ unread, onMore }: { unread: number; onMore: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <nav
      aria-label="التنقّل السريع"
      // The upward shadow is tinted with the brand teal rather than plain black, which reads as
      // grime against the surface colours. paddingBottom clears the iPhone home indicator.
      className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-nav md:hidden dark:border-slate-800 dark:bg-slate-900"
    >
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cx(tabClass, active ? "text-brand" : "text-slate-500 dark:text-slate-400")}
          >
            <Icon name={tab.icon} active={active} />
            <span>{tab.label}</span>
            {/* A dot, not colour alone — the active tab stays identifiable without relying on hue. */}
            <span className={cx("h-1 w-1 rounded-full", active ? "bg-brand" : "bg-transparent")} />
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onMore}
        aria-label="المزيد من الأقسام"
        className={cx(tabClass, "relative text-slate-500 dark:text-slate-400")}
      >
        {/* The badge is anchored to the icon rather than the tab, so it needs no direction-aware
            offsets to sit on the right corner in either writing direction. */}
        <span className="relative">
          <Icon name="more" active={false} />
          {/* Notifications live behind this tab, so the count has to surface here or a phone user
              never learns there is anything to read. */}
          {unread > 0 && (
            <span className="absolute -top-1 -end-2 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
        <span>المزيد</span>
        <span className="h-1 w-1 rounded-full bg-transparent" />
      </button>
    </nav>
  );
}
