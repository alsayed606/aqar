"use client";

import Link from "next/link";
import { useState } from "react";

// Real plan data seeded in migration 0036 (prices are monthly SAR, VAT excluded).
type Plan = {
  code: string;
  name: string;
  tagline: string;
  monthly: number | null; // null = custom / contact sales
  limits: string[];
  featured?: boolean;
  cta: { label: string; href: string };
};

const PLANS: Plan[] = [
  {
    code: "basic",
    name: "الأساسية",
    tagline: "للمكتب الناشئ",
    monthly: 99,
    limits: ["حتى 25 عقاراً", "حتى 150 وحدة", "٣ مستخدمين", "مستخدم واحد للمنشأة"],
    cta: { label: "ابدأ التجربة المجانية", href: "/login" },
  },
  {
    code: "pro",
    name: "الاحترافية",
    tagline: "للشركة العقارية",
    monthly: 299,
    limits: ["حتى 100 عقار", "حتى 500 وحدة", "١٠ مستخدمين", "أدوار وصلاحيات كاملة"],
    featured: true,
    cta: { label: "ابدأ التجربة المجانية", href: "/login" },
  },
  {
    code: "enterprise",
    name: "المؤسسية",
    tagline: "للمجموعات الكبرى",
    monthly: null,
    limits: ["عقارات ووحدات غير محدودة", "مستخدمون غير محدودون", "دعم مخصّص", "متطلبات خاصة"],
    cta: { label: "تواصل معنا", href: "mailto:info@6n1.io?subject=خطة%20المؤسسية%20—%20عقار" },
  },
];

// Annual list price = 20% off 12 months (marketing display; monthly billing is the wired default).
function annualTotal(monthly: number): number {
  return Math.round(monthly * 12 * 0.8);
}

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white">خطط تناسب حجم محفظتك</h2>
        <p className="mt-3 text-slate-600 dark:text-slate-400">ابدأ بتجربة مجانية 30 يوماً بلا بطاقة. بدّل الخطة متى شئت.</p>
      </div>

      {/* Billing toggle */}
      <div className="mt-8 flex items-center justify-center gap-3">
        <span className={annual ? "text-sm text-slate-500" : "text-sm font-semibold text-slate-900 dark:text-white"}>شهري</span>
        <button
          type="button"
          role="switch"
          aria-checked={annual}
          aria-label="التبديل بين الدفع الشهري والسنوي"
          onClick={() => setAnnual((v) => !v)}
          className={"relative h-6 w-11 rounded-full transition-colors " + (annual ? "bg-brand" : "bg-slate-300 dark:bg-slate-700")}
        >
          <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " + (annual ? "left-0.5" : "right-0.5")} />
        </button>
        <span className={annual ? "text-sm font-semibold text-slate-900 dark:text-white" : "text-sm text-slate-500"}>
          سنوي <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">وفّر 20%</span>
        </span>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.code}
            className={
              "relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm dark:bg-slate-900 " +
              (p.featured ? "border-brand ring-1 ring-brand" : "border-slate-200 dark:border-slate-800")
            }
          >
            {p.featured && (
              <span className="absolute -top-3 right-6 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">
                الأكثر طلباً
              </span>
            )}
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{p.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{p.tagline}</p>

            <div className="mt-4 min-h-[4.5rem]">
              {p.monthly === null ? (
                <p className="text-3xl font-extrabold text-slate-900 dark:text-white">حسب الطلب</p>
              ) : annual ? (
                <>
                  <p className="text-3xl font-extrabold text-slate-900 dark:text-white">
                    {annualTotal(p.monthly).toLocaleString("en-US")}
                    <span className="text-base font-medium text-slate-500"> ر.س / سنوياً</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">أي ما يعادل {Math.round(annualTotal(p.monthly) / 12).toLocaleString("en-US")} ر.س شهرياً</p>
                </>
              ) : (
                <p className="text-3xl font-extrabold text-slate-900 dark:text-white">
                  {p.monthly.toLocaleString("en-US")}
                  <span className="text-base font-medium text-slate-500"> ر.س / شهرياً</span>
                </p>
              )}
            </div>

            <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {p.limits.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href={p.cta.href}
              className={
                "mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold " +
                (p.featured
                  ? "bg-brand text-white hover:bg-brand-fg"
                  : "border border-slate-300 text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800")
              }
            >
              {p.cta.label}
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        الأسعار لا تشمل ضريبة القيمة المضافة. الفوترة الشهرية عبر بطاقة مدى/فيزا؛ للاشتراك السنوي تواصل معنا.
      </p>
    </section>
  );
}
