import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "سياسة الخصوصية | عقار" };

// Initial privacy notice aligned with PDPL principles. Review with legal counsel before launch.
export default function PrivacyPage() {
  return (
    <LegalShell title="سياسة الخصوصية" updated="٢٨ يوليو ٢٠٢٦">
      <p>
        توضّح هذه السياسة كيف تجمع منصّة «عقار» بياناتك وتستخدمها وتحميها عند استخدامك للنظام، بما يتوافق
        مع مبادئ نظام حماية البيانات الشخصية (PDPL) في المملكة العربية السعودية.
      </p>

      <H>١. البيانات التي نعالجها</H>
      <ul>
        <li>بيانات الحساب: الاسم والبريد الإلكتروني ورقم الجوال.</li>
        <li>بيانات المنشأة: اسم المكتب/الشركة وبياناتها التجارية والضريبية.</li>
        <li>بيانات التشغيل التي تُدخلها: العقارات والوحدات والعقود والملّاك والمستأجرون والمعاملات المالية.</li>
        <li>بيانات تقنية محدودة لأمان الخدمة وتشغيلها (سجلّات الدخول والنشاط).</li>
      </ul>

      <H>٢. الغرض من المعالجة</H>
      <ul>
        <li>تقديم خدمة إدارة الأملاك وتشغيل حسابك ومنشأتك.</li>
        <li>إصدار السندات والفواتير والتقارير المالية.</li>
        <li>إرسال الإشعارات التشغيلية (استحقاقات، تجديدات، تنبيهات).</li>
        <li>تحسين الخدمة وحمايتها من إساءة الاستخدام.</li>
      </ul>

      <H>٣. عزل البيانات والأمان</H>
      <p>
        بيانات كل منشأة معزولة تماماً عن غيرها عبر سياسات أمان على مستوى قاعدة البيانات (Row-Level Security).
        يقتصر الوصول على المستخدمين المصرّح لهم داخل المنشأة وبحسب أدوارهم وصلاحياتهم.
      </p>

      <H>٤. مشاركة البيانات</H>
      <p>
        لا نبيع بياناتك. قد نستعين بمزوّدي خدمات موثوقين لتشغيل المنصّة (استضافة سحابية، إرسال بريد، بوابة دفع)
        ضمن حدود ما تتطلبه الخدمة فقط، ووفق ضوابط حماية مناسبة.
      </p>

      <H>٥. حقوقك</H>
      <ul>
        <li>الوصول إلى بياناتك وتصحيحها.</li>
        <li>طلب حذف حسابك وبياناتك ضمن الحدود النظامية.</li>
        <li>الاعتراض على معالجة معيّنة أو تقييدها.</li>
      </ul>

      <H>٦. الاحتفاظ بالبيانات</H>
      <p>نحتفظ ببياناتك طوال فترة اشتراكك وبالقدر اللازم للوفاء بالالتزامات النظامية والمحاسبية بعد ذلك.</p>

      <H>٧. التواصل</H>
      <p>لأي استفسار حول الخصوصية أو لممارسة حقوقك، تواصل معنا عبر البريد: <span dir="ltr">privacy@example.com</span>.</p>

      <Note>هذه نسخة أوّلية للاسترشاد، ويُنصح بمراجعتها قانونياً قبل الإطلاق الرسمي.</Note>
    </LegalShell>
  );
}

function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-xl font-extrabold">عقار</Link>
          <Link href="/" className="text-sm text-slate-500 hover:text-brand">← العودة للرئيسية</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">آخر تحديث: {updated}</p>
        <div className="mt-8 space-y-4 leading-8 text-slate-700 dark:text-slate-300 [&_li]:mr-5 [&_li]:list-disc [&_ul]:space-y-1">
          {children}
        </div>
      </main>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-4 text-lg font-bold text-slate-900 dark:text-white">{children}</h2>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">{children}</p>;
}
