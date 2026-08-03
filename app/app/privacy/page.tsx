import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { OrgExportButton } from "@/components/org-export-button";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { cancelDeletion } from "./actions";

export const dynamic = "force-dynamic";

export default async function PrivacyCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const caps = await getCapabilities(activeOrg);
  // The RPCs gate on is_org_admin, i.e. owner or admin. manage_billing is the capability held by
  // exactly those two roles (0041), so the screen hides what the database would refuse anyway.
  const isAdmin = caps.has("manage_billing");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organization")
    .select("name, purge_after, deletion_reason")
    .eq("id", activeOrg)
    .maybeSingle();
  const purgeAfter = org?.purge_after ? new Date(org.purge_after) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">الخصوصية والبيانات</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          حقوقك على بيانات منشأتك وفق نظام حماية البيانات الشخصية (PDPL). للاطّلاع على السياسة الكاملة:{" "}
          <Link href="/privacy" className="text-brand underline">سياسة الخصوصية</Link>.
        </p>
      </div>

      {ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          تم إلغاء طلب الحذف.
        </p>
      )}

      {purgeAfter && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <h2 className="font-bold text-red-800 dark:text-red-300">حساب المنشأة مجدوَل للحذف</h2>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            سيُحذف نهائياً بتاريخ <b>{purgeAfter.toLocaleDateString("ar-SA")}</b>. حسابك يعمل بشكل طبيعي حتى ذلك التاريخ،
            ويمكنك التراجع في أي وقت قبله.
          </p>
          {isAdmin && (
            <form action={cancelDeletion} className="mt-3">
              <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:bg-neutral-900">
                إلغاء طلب الحذف
              </button>
            </form>
          )}
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">نسخة من بياناتك</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          ملف <span dir="ltr">JSON</span> يحوي بيانات منشأتك: الأعضاء والملّاك والمستأجرون والعقارات والوحدات والعقود
          والاستحقاقات والمدفوعات والفواتير.
        </p>
        {isAdmin ? (
          <OrgExportButton />
        ) : (
          <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            تنزيل نسخة كاملة متاح لمدراء المنشأة.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">حذف بيانات مستأجر أو مالك</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          إذا طلب مستأجر أو مالك حذف بياناته الشخصية، فالطلب يُنفَّذ من صفحته مباشرة — لأن منشأتك هي المتحكّم في تلك
          البيانات ونحن المعالج لها. افتح صفحة الشخص ثم «حذف البيانات الشخصية».
        </p>
        <Link href="/app/tenants" className="inline-block text-sm text-brand underline">الذهاب إلى المستأجرين</Link>
      </section>

      {/* Stated before the button, not after: someone who reads only one line should read this one. */}
      <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">ما نحتفظ به بحكم النظام</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          حذف البيانات الشخصية <b>لا يشمل الفواتير الضريبية</b>. تُلزم أنظمة الزكاة والضريبة والجمارك بالاحتفاظ بها،
          وحذفها يعرّض منشأتك للمخالفة. تبقى الفاتورة كما صدرت، ويُحذف ما عداها من البيانات الشخصية.
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          كما نحتفظ بسجلّ مدفوعات اشتراكك في «عقار» بعد حذف الحساب، لأنه سجلّ مبيعاتنا نحن وتلزمنا الأنظمة الضريبية
          بحفظه.
        </p>
      </section>

      {isAdmin && !purgeAfter && (
        <section className="space-y-3 rounded-2xl border border-red-300 bg-white p-6 shadow-sm dark:border-red-900 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">حذف حساب المنشأة</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            يُحذف الحساب وكل بياناته نهائياً بعد <b>٣٠ يوماً</b> من الطلب. خلال هذه المدة يعمل حسابك بشكل طبيعي ويمكنك
            التراجع. بعدها لا يمكن الاسترجاع.
          </p>
          <DeleteAccountForm />
        </section>
      )}
    </div>
  );
}
