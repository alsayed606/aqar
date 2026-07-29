"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS = [
  { href: "#features", label: "المميزات" },
  { href: "#solutions", label: "الحلول" },
  { href: "#pricing", label: "الخطط" },
  { href: "#faq", label: "الأسئلة الشائعة" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-50/80 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-extrabold text-slate-900 dark:text-white">عقار</Link>
          <nav className="hidden gap-6 text-sm text-slate-600 md:flex dark:text-slate-300">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-brand">{l.label}</a>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-brand dark:text-slate-300">
            تسجيل الدخول
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-fg"
          >
            ابدأ التجربة المجانية
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
          aria-expanded={open}
          className="rounded-lg border border-slate-300 p-2 text-slate-700 md:hidden dark:border-slate-700 dark:text-slate-200"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <nav className="border-t border-slate-200 px-4 py-3 md:hidden dark:border-slate-800">
          <ul className="space-y-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-center text-sm font-medium dark:border-slate-700">
              تسجيل الدخول
            </Link>
            <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand-fg">
              ابدأ التجربة المجانية
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
