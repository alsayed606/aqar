"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { signOutPlatform } from "@/app/platform/actions";
import { Drawer } from "@/components/ui";

// Navigation for the platform console. Deliberately its own file with its own state: it shares no
// context with the office sidebar, and it is styled dark so you can never mistake which surface you
// are looking at — one of these views can change a customer's billing.
//
// Modules that are not built yet are listed and marked «قريباً» rather than hidden. The roadmap is
// part of the console: a missing item reads as "lost", a marked one reads as "not yet".

type Item = { href: string; label: string; icon: ReactNode; soon?: boolean };
type Group = { title: string; items: Item[] };

const I = {
  chart: <><path d="M3 3v18h18" /><path d="M7 15l3-4 3 3 5-7" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  receipt: <><path d="M5 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z" /><path d="M9 8h6M9 12h4" /></>,
  pulse: <><path d="M3 12h4l3 8 4-16 3 8h4" /></>,
  alert: <><path d="M12 3l9 16H3l9-16z" /><path d="M12 9v4M12 17h.01" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>,
  users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M17 11a3 3 0 1 0 0-6" /></>,
  life: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></>,
  send: <><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-8-8-4 19-6z" /></>,
  flag: <><path d="M5 21V4h13l-2 4 2 4H5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a7.9 7.9 0 0 0 .1-3l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.6-1.5L14.2 4h-4l-.4 2.6A8 8 0 0 0 7.2 8.1l-2.3-1-2 3.4L4.9 12a7.9 7.9 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.3 1 2-3.4z" /></>,
};

const GROUPS: Group[] = [
  { title: "القيادة", items: [{ href: "/platform", label: "اللوحة التنفيذية", icon: I.chart }] },
  {
    title: "العملاء",
    items: [
      { href: "/platform/tenants", label: "المكاتب", icon: I.building },
      { href: "#", label: "المستخدمون", icon: I.users, soon: true },
    ],
  },
  {
    title: "الإيراد",
    items: [
      { href: "/platform/subscriptions", label: "مركز الاشتراكات", icon: I.card },
      { href: "/platform/billing", label: "مركز الفوترة", icon: I.receipt },
    ],
  },
  {
    title: "التشغيل",
    items: [
      { href: "/platform/health", label: "صحة المنصة", icon: I.pulse },
      { href: "/platform/alerts", label: "التنبيهات", icon: I.alert },
      { href: "/platform/audit", label: "مركز التدقيق", icon: I.shield },
      { href: "#", label: "الدعم", icon: I.life, soon: true },
    ],
  },
  {
    title: "الضبط",
    items: [
      { href: "/platform/broadcast", label: "البثّ", icon: I.send },
      { href: "/platform/features", label: "الميزات", icon: I.flag },
      { href: "/platform/settings", label: "إعدادات المنصة", icon: I.gear },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/platform" ? pathname === "/platform" : pathname.startsWith(href);
}

function Sv({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {children}
    </svg>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) =>
              it.soon ? (
                <li key={it.label}>
                  <span className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-500">
                    <span className="flex items-center gap-2.5"><Sv>{it.icon}</Sv>{it.label}</span>
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px]">قريباً</span>
                  </span>
                </li>
              ) : (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    className={
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors " +
                      (isActive(pathname, it.href)
                        ? "bg-white/10 font-medium text-white"
                        : "text-slate-300 hover:bg-white/5 hover:text-white")
                    }
                  >
                    <Sv>{it.icon}</Sv>
                    {it.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/platform" className="block">
      <span className="text-lg font-extrabold text-white">عقار</span>
      <span className="ms-2 rounded bg-brand/30 px-1.5 py-0.5 text-[10px] font-medium text-teal-200">المنصة</span>
    </Link>
  );
}

function SignOut() {
  return (
    <form action={signOutPlatform}>
      <button className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
        تسجيل الخروج
      </button>
    </form>
  );
}

export function PlatformSidebar({ operatorLabel }: { operatorLabel: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="no-print fixed inset-y-0 right-0 z-30 hidden w-64 flex-col border-l border-slate-800 bg-slate-900 md:flex">
        <div className="border-b border-slate-800 px-5 py-4">
          <Brand />
          {operatorLabel && <p className="mt-1 truncate text-xs text-slate-500">{operatorLabel}</p>}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavContent />
        </div>
        <div className="border-t border-slate-800 px-5 py-4">
          <SignOut />
        </div>
      </aside>

      <div className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="فتح القائمة"
          className="rounded-lg p-2 text-slate-300 hover:bg-white/5"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} title="قائمة المنصة">
        <div className="rounded-xl bg-slate-900 p-3">
          <NavContent onNavigate={() => setOpen(false)} />
          <div className="mt-4 border-t border-slate-800 pt-4">
            <SignOut />
          </div>
        </div>
      </Drawer>
    </>
  );
}
