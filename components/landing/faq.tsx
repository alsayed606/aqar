"use client";

import { useState } from "react";

const ITEMS = [
  {
    q: "هل الفواتير متوافقة مع هيئة الزكاة والضريبة (ZATCA)؟",
    a: "نعم. يُصدر النظام فواتير ضريبية متوافقة مع المرحلة الأولى من الفوترة الإلكترونية (الإصدار مع رمز QR ومعرّفات الضريبة). ربط المرحلة الثانية (التكامل المباشر مع الهيئة) مُدرَج على خارطة الطريق.",
  },
  {
    q: "كيف تعمل التجربة المجانية لمدة 30 يوماً؟",
    a: "تبدأ بحساب كامل بحدود الخطة الأساسية لمدة 30 يوماً دون الحاجة إلى بطاقة. تبقى بياناتك محفوظة بعد انتهاء التجربة، وتختار الخطة المناسبة لمواصلة الإضافة.",
  },
  {
    q: "ما مستوى الأمان وعزل بيانات كل منشأة؟",
    a: "كل منشأة معزولة تماماً عن غيرها عبر سياسات أمان صفّية (RLS) مفروضة على مستوى قاعدة البيانات نفسها — لا على الواجهة فقط. بيانات منشأتين لا تختلط إطلاقاً، وصلاحية كل مستخدم محدودة بدوره ونطاقه.",
  },
  {
    q: "هل النظام متوافق مع نظام حماية البيانات الشخصية (PDPL)؟",
    a: "نلتزم بمبادئ نظام حماية البيانات الشخصية: صلاحيات دقيقة، تحكّم صارم بالوصول، وسياسة خصوصية واضحة تبيّن البيانات التي نعالجها وحقوقك تجاهها.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white">الأسئلة الشائعة</h2>
        <p className="mt-3 text-slate-600 dark:text-slate-400">أكثر ما يسأل عنه أصحاب المكاتب العقارية.</p>
      </div>

      <div className="mt-10 space-y-3">
        {ITEMS.map((it, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-right"
              >
                <span className="font-semibold text-slate-900 dark:text-white">{it.q}</span>
                <svg
                  width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  className={"shrink-0 text-brand transition-transform " + (isOpen ? "rotate-180" : "")}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isOpen && (
                <p className="border-t border-slate-100 px-5 py-4 text-sm leading-7 text-slate-600 dark:border-slate-800 dark:text-slate-300">
                  {it.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
