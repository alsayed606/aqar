import Link from "next/link";
import type { ReactNode } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";

// Marketing landing page (public). The old Supabase health screen moved to /api/health (JSON probe).
export const dynamic = "force-static";

function Icon({ path }: { path: ReactNode }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

const FEATURES = [
  {
    title: "إدارة العقارات والوحدات والملّاك",
    body: "سجلّ موحّد لمبانيك ووحداتك وملّاكك، وحالة كل وحدة (مؤجرة أو شاغرة) في لحظة.",
    icon: <><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></>,
  },
  {
    title: "إصدار وتوثيق العقود وتنبيهات الإشغال",
    body: "أنشئ عقود الإيجار وجدولة استحقاقاتها، مع تنبيهات الانتهاء والتجديد قبل فواتها.",
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15l2 2 4-4" /></>,
  },
  {
    title: "السندات المالية وفواتير ZATCA",
    body: "سندات قبض وصرف مرقّمة، وفواتير ضريبية متوافقة مع المرحلة الأولى (رمز QR ومعرّفات الضريبة).",
    icon: <><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2z" /><path d="M8 8h8" /><path d="M8 12h6" /></>,
  },
  {
    title: "بوابات مستقلة للملّاك والمستأجرين",
    body: "وصول ذاتي آمن للمالك والمستأجر إلى عقودهم وكشوفهم وفواتيرهم — دون مراجعة المكتب.",
    icon: <><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" /></>,
  },
  {
    title: "إدارة الأدوار والصلاحيات (RBAC)",
    body: "حدّد ما يراه ويفعله كل موظف حسب دوره ونطاقه — مالك، محاسب، موظف، مطّلع.",
    icon: <><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  },
  {
    title: "أمان عالٍ وعزل تام للبيانات",
    body: "عزل كامل لبيانات كل منشأة عبر سياسات أمان على مستوى قاعدة البيانات — لا تختلط منشأتان أبداً.",
    icon: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /><circle cx="12" cy="16" r="1" /></>,
  },
];

const AUDIENCES = [
  { title: "المكاتب العقارية", body: "أدِر محافظ عملائك باحتراف: ملف مستقل لكل مالك بعقوده وتحصيله وكشف حسابه." },
  { title: "ملّاك العقارات", body: "كل ما تحتاجه لإدارة أملاكك بنفسك — عقود منظّمة، وتحصيل منتظم، وأرقام واضحة." },
  { title: "الشركات والمجموعات", body: "حوكمة للفرق الكبيرة: صلاحيات دقيقة، نطاقات لكل موظف، وتقارير مالية فورية." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <LandingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
              منصّة سعودية لإدارة الأملاك
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight text-slate-900 sm:text-5xl dark:text-white">
              إدارة عقاراتك وعقودك الإلكترونية في منصة سحابية واحدة آمنة
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">
              منصة متكاملة لتنسيق العقود، وسندات القبض، وفواتير ZATCA، وإشغال الوحدات — بمرونة عالية وعزل تام لبيانات منشأتك.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-fg">
                جرّب النظام مجاناً
              </Link>
              <a href="mailto:info@6n1.io?subject=طلب%20عرض%20توضيحي%20—%20عقار" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">
                طلب عرض توضيحي
              </a>
            </div>
            <p className="mt-4 text-xs text-slate-500">تجربة مجانية 30 يوماً · بلا بطاقة · إلغاء في أي وقت</p>
          </div>

          <HeroMockup />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white">كل ما يحتاجه مكتبك في منصّة واحدة</h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">من العقد حتى التحصيل والتقارير — منظّمة وواضحة، لا متفرّقة.</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition hover:border-brand hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Icon path={f.icon} />
              </div>
              <h3 className="mt-4 font-bold text-slate-900 dark:text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solutions / audiences */}
      <section id="solutions" className="border-y border-slate-200 bg-white py-20 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white">مهما كان دورك في السوق العقاري</h2>
            <p className="mt-3 text-slate-600 dark:text-slate-400">حلول مصمّمة لطريقة عملك.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {AUDIENCES.map((a) => (
              <div key={a.title} className="rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
                <h3 className="font-bold text-slate-900 dark:text-white">{a.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Pricing />
      <Faq />

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="rounded-3xl bg-brand px-6 py-12 text-center text-white sm:px-12">
          <h2 className="text-3xl font-extrabold">جاهز تبسّط إدارة أملاكك؟</h2>
          <p className="mt-3 text-white/90">ابدأ تجربتك اليوم — كل عملياتك في منصة واحدة.</p>
          <Link href="/login" className="mt-6 inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-brand hover:bg-slate-100">
            ابدأ التجربة المجانية
          </Link>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

function HeroMockup() {
  const tiles = [
    { label: "الإشغال", value: "87%" },
    { label: "تحصيل الشهر", value: "٤٨٬٢٠٠" },
    { label: "عقود نشطة", value: "٣٦" },
    { label: "متأخرات", value: "٢" },
  ];
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-800 dark:bg-slate-900" dir="rtl" aria-hidden="true">
      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
        <div className="mb-4 flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="ms-3 text-xs text-slate-400">لوحة المؤشرات — عقار</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
              <div className="text-lg font-bold text-slate-900 dark:text-white">{t.value}</div>
              <div className="text-[10px] text-slate-500">{t.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 h-2 w-24 rounded bg-brand/30" />
          {[68, 92, 45].map((w, i) => (
            <div key={i} className="flex items-center justify-between border-t border-slate-100 py-2 dark:border-slate-800">
              <div className="h-2 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${w}px` }} />
              <div className="h-4 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="text-xl font-extrabold text-slate-900 dark:text-white">عقار</p>
          <p className="mt-2 max-w-xs text-sm text-slate-500">منصّة سعودية سحابية لإدارة الأملاك والعقارات للمكاتب والشركات.</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">المنتج</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-500">
            <li><a href="#features" className="hover:text-brand">المميزات</a></li>
            <li><a href="#pricing" className="hover:text-brand">الخطط</a></li>
            <li><a href="#faq" className="hover:text-brand">الأسئلة الشائعة</a></li>
            <li><Link href="/login" className="hover:text-brand">تسجيل الدخول</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">قانوني</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-500">
            <li><Link href="/privacy" className="hover:text-brand">سياسة الخصوصية</Link></li>
            <li><Link href="/terms" className="hover:text-brand">الشروط والأحكام</Link></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-6xl border-t border-slate-200 px-4 pt-6 text-center text-xs text-slate-500 dark:border-slate-800">
        © 2026 عقار. جميع الحقوق محفوظة.
      </div>
    </footer>
  );
}
