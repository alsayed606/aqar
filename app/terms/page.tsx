import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "الشروط والأحكام | عقار" };

// Initial terms of service. Review with legal counsel before launch.
export default function TermsPage() {
  return (
    <LegalShell title="الشروط والأحكام" updated="٢٨ يوليو ٢٠٢٦">
      <p>
        باستخدامك منصّة «عقار» فإنك توافق على هذه الشروط. يُرجى قراءتها بعناية؛ فإن لم توافق عليها فلا تستخدم الخدمة.
      </p>

      <H>١. وصف الخدمة</H>
      <p>
        «عقار» منصّة سحابية لإدارة الأملاك تتيح إدارة العقارات والوحدات والعقود والملّاك والمستأجرين، وإصدار
        السندات والفواتير والتقارير المالية.
      </p>

      <H>٢. الحساب والمنشأة</H>
      <ul>
        <li>أنت مسؤول عن صحة بيانات حسابك ومنشأتك والحفاظ على سرية بيانات الدخول.</li>
        <li>أنت مسؤول عن كل نشاط يجري عبر حسابك ومستخدميك.</li>
        <li>يمكن لكل مستخدم إنشاء منشأة واحدة، والانضمام إلى منشآت أخرى عبر دعوة.</li>
      </ul>

      <H>٣. الاشتراك والدفع</H>
      <ul>
        <li>تبدأ الخدمة بتجربة مجانية مدّتها 30 يوماً بحدود الخطة الأساسية.</li>
        <li>بعد التجربة يتطلّب الاستمرار في إضافة البيانات اشتراكاً في إحدى الخطط.</li>
        <li>الأسعار المعلنة لا تشمل ضريبة القيمة المضافة ما لم يُذكر خلاف ذلك.</li>
        <li>عند انتهاء الاشتراك تبقى بياناتك محفوظة للاطلاع، ويتوقّف إنشاء عناصر جديدة.</li>
      </ul>

      <H>٤. الاستخدام المقبول</H>
      <ul>
        <li>يُمنع استخدام الخدمة لأي غرض غير نظامي أو للإضرار بالنظام أو بالمستخدمين الآخرين.</li>
        <li>يُمنع محاولة الوصول غير المصرّح به إلى بيانات منشآت أخرى.</li>
      </ul>

      <H>٥. البيانات والخصوصية</H>
      <p>
        تخضع معالجة بياناتك لـ<Link href="/privacy" className="text-brand hover:underline"> سياسة الخصوصية</Link>.
        تبقى بيانات منشأتك ملكاً لك، ونعالجها لتقديم الخدمة فقط.
      </p>

      <H>٦. حدود المسؤولية</H>
      <p>
        تُقدَّم الخدمة «كما هي». نبذل جهداً معقولاً لضمان توافرها ودقّتها، ولا نتحمّل المسؤولية عن أضرار غير
        مباشرة ناتجة عن الاستخدام ضمن الحدود التي يسمح بها النظام.
      </p>

      <H>٧. التعديلات والقانون الواجب التطبيق</H>
      <p>
        قد نُحدّث هذه الشروط، وسنُشعرك بالتغييرات الجوهرية. تخضع هذه الشروط لأنظمة المملكة العربية السعودية.
      </p>

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
