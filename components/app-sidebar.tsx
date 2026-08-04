"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { signOut } from "@/app/app/actions";
import { Drawer } from "@/components/ui";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";

type Item = { href: string; label: string; icon: ReactNode; badge?: number; add?: string; soon?: boolean };
type Group = { title?: string; items: Item[] };

const I = {
  home: <><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M17 11a3 3 0 1 0 0-6" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></>,
  invoice: <><path d="M5 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z" /><path d="M9 8h6M9 12h4" /></>,
  receipt: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  wrench: <><path d="M14 7a4 4 0 0 1-5 5L4 17l3 3 5-5a4 4 0 0 1 5-5l-3-3z" /></>,
  gauge: <><path d="M3 17a9 9 0 1 1 18 0" /><path d="M12 17l4-5" /><circle cx="12" cy="17" r="1.5" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M12 3v12M7 8l5-5 5 5" /></>,
  team: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.5a3 3 0 0 1 0 7M21 21v-2a3.5 3.5 0 0 0-3-3.4" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  shield: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></>,
  lock: <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.1a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.3 8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.3V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z" /></>,
};

function groups(unread: number): Group[] {
  return [
    { items: [{ href: "/app", label: "الرئيسية", icon: I.home }] },
    {
      title: "إدارة العقارات",
      items: [
        { href: "/app/properties", label: "العقارات", icon: I.building, add: "/app/properties?add=1" },
        { href: "/app/units", label: "الوحدات", icon: I.layers },
        { href: "/app/contracts", label: "عقود التأجير", icon: I.doc, add: "/app/contracts?add=1" },
        { href: "/app/owners", label: "الملّاك", icon: I.users },
        { href: "/app/tenants", label: "المستأجرون", icon: I.user },
      ],
    },
    {
      title: "المالية والتحصيل",
      items: [
        { href: "/app/invoices", label: "الفواتير", icon: I.invoice },
        { href: "/app/receipts", label: "السندات", icon: I.receipt },
        { href: "/app/subscription", label: "الاشتراك", icon: I.card },
      ],
    },
    {
      // Meters are utilities, not faults — a section of their own, not a corner of maintenance.
      title: "المرافق",
      items: [
        { href: "/app/utilities", label: "العدادات", icon: I.gauge, add: "/app/utilities?add=1" },
        { href: "/app/utilities/readings", label: "القراءات", icon: I.list },
      ],
    },
    {
      title: "الصيانة والطلبات",
      items: [{ href: "#", label: "طلبات الصيانة", icon: I.wrench, soon: true }],
    },
    {
      title: "الإدارة",
      items: [
        { href: "/app/settings", label: "إعدادات المنشأة", icon: I.cog },
        { href: "/app/import", label: "الاستيراد", icon: I.upload },
        { href: "/app/team", label: "الفريق", icon: I.team },
        { href: "/app/notifications", label: "الإشعارات", icon: I.bell, badge: unread },
        { href: "/app/security", label: "أمان الحساب", icon: I.lock },
        { href: "/app/privacy", label: "الخصوصية والبيانات", icon: I.shield },
      ],
    },
  ];
}

// Only the most specific match lights up. With /app/utilities and /app/utilities/readings both in
// the nav, a plain startsWith would highlight the parent on the child's page as well.
function activeHref(pathname: string, unread: number): string | null {
  let best: string | null = null;
  for (const g of groups(unread)) {
    for (const it of g.items) {
      if (it.soon) continue;
      const matches = it.href === "/app" ? pathname === "/app" : pathname.startsWith(it.href);
      if (matches && (best === null || it.href.length > best.length)) best = it.href;
    }
  }
  return best;
}

function Sv({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {children}
    </svg>
  );
}

function NavContent({ unread, onNavigate }: { unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeHref(pathname, unread);
  return (
    <nav className="space-y-5">
      {groups(unread).map((g, gi) => (
        <div key={g.title ?? gi}>
          {g.title && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = !it.soon && it.href === current;
              if (it.soon) {
                return (
                  <li key={it.label}>
                    <span className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400">
                      <span className="flex items-center gap-2.5"><Sv>{it.icon}</Sv>{it.label}</span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-slate-800">قريباً</span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={it.href} className="flex items-center">
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    className={
                      "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors " +
                      (active ? "bg-brand/10 font-medium text-brand" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")
                    }
                  >
                    <Sv>{it.icon}</Sv>
                    <span className="flex-1">{it.label}</span>
                    {it.badge ? (
                      <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium text-white">
                        {it.badge > 99 ? "99+" : it.badge}
                      </span>
                    ) : null}
                  </Link>
                  {it.add && (
                    <Link
                      href={it.add}
                      onClick={onNavigate}
                      aria-label={`إضافة (${it.label})`}
                      className="ms-1 rounded-lg p-1.5 text-slate-400 hover:bg-brand/10 hover:text-brand"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SignOut({ full }: { full?: boolean }) {
  return (
    <form action={signOut}>
      <button className={(full ? "w-full " : "") + "rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"}>
        تسجيل الخروج
      </button>
    </form>
  );
}

export function AppSidebar({ orgName, unread }: { orgName: string | null; unread: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar (RTL start = right) */}
      <aside className="no-print fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-slate-200 bg-white md:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <Link href="/app" className="text-xl font-extrabold text-slate-900 dark:text-white">عقار</Link>
          {orgName && <p className="mt-0.5 truncate text-xs text-slate-500">{orgName}</p>}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavContent unread={unread} />
        </div>
        <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <SignOut full />
        </div>
      </aside>

      {/* Mobile top bar — identity only. The menu opener moved to the bottom bar, within reach of a
          thumb; two openers for the same drawer is the duplication §5.3 argues against. */}
      <div className="no-print sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 md:hidden dark:border-slate-800 dark:bg-slate-900">
        <Link href="/app" className="text-lg font-extrabold text-slate-900 dark:text-white">عقار</Link>
        {orgName && <span className="truncate text-xs text-slate-500">{orgName}</span>}
      </div>

      <MobileBottomNav unread={unread} onMore={() => setOpen(true)} />

      {/* Mobile drawer — shared by the bottom bar's "المزيد" tab */}
      <Drawer open={open} onClose={() => setOpen(false)} title={orgName ?? "القائمة"} footer={<SignOut full />}>
        <NavContent unread={unread} onNavigate={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
