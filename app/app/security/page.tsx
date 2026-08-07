import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaEnroll } from "@/components/mfa-enroll";
import { EmailMfaEnroll } from "@/components/email-mfa-enroll";
import { emailFactorState } from "@/lib/mfa";
import { maskEmail } from "@/lib/mfa-server";
import { removeFactor, disableEmailMfa } from "./actions";

export const dynamic = "force-dynamic";

const OK_AR: Record<string, string> = {
  enrolled: "فُعّل التحقّق بخطوتين. ستُطلب منك رمزاً عند كل تسجيل دخول.",
  removed: "أُلغي التحقّق بخطوتين.",
  email_enrolled: "فُعّل التحقّق برمز البريد. سيصلك رمز عند كل تسجيل دخول من جهاز جديد.",
  email_removed: "أُلغي التحقّق برمز البريد.",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/security");

  // Only verified factors count. An abandoned enrolment leaves an unverified row behind, and showing
  // it as active would tell the user they are protected when they are not.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const isOperator = (await supabase.rpc("is_platform_operator")).data === true;
  const email = await emailFactorState(supabase);
  const anyFactor = verified.length > 0 || email.enabled;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">أمان الحساب</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          إعدادات تخصّ حسابك أنت، لا منشأتك. تنطبق على كل منشأة تدخل إليها بهذا الحساب.
        </p>
      </div>

      {ok && OK_AR[ok] && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          {OK_AR[ok]}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>
      )}

      {isOperator && !anyFactor && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <b>حسابك مشغّل منصّة.</b> التحقّق بخطوتين <b>إلزامي</b> للوصول إلى لوحة الإدارة العليا — فعّله أدناه.
        </p>
      )}

      {/* The e-mail code comes first because it is what almost everyone will use: nothing to install,
          nothing to lose. The authenticator app follows as the stronger option for whoever wants it. */}
      <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <h2 className="text-lg font-semibold">رمز يُرسَل إلى بريدك</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            عند كل تسجيل دخول نرسل رمزاً من ستّة أرقام إلى بريدك، ولا يكتمل الدخول قبل إدخاله.
            لا يحتاج تطبيقاً ولا شيئاً تحفظه.
          </p>
        </div>

        {!email.enabled ? (
          <>
            {user.email ? (
              <EmailMfaEnroll masked={maskEmail(user.email)} />
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                لا يوجد بريد على حسابك، ولا يمكن إرسال الرمز بدونه.
              </p>
            )}
            {/* Said plainly rather than left for the user to discover: this protects a leaked
                password, not a taken inbox — and the inbox already resets the password. */}
            <p className="text-xs text-neutral-500">
              يحمي هذا من سرقة كلمة المرور وحدها. أمّا من يدخل بريدك فيستطيع أصلاً إعادة تعيين كلمة المرور —
              ومن أراد حماية من ذلك أيضاً فليستخدم تطبيق المصادقة أدناه.
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              ✓ مُفعّل — يُرسَل إلى <span dir="ltr">{maskEmail(email.destination ?? "")}</span>
            </p>
            <form action={disableEmailMfa}>
              <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20">
                إلغاء
              </button>
            </form>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <h2 className="text-lg font-semibold">تطبيق المصادقة <span className="text-sm font-normal text-neutral-500">— الخيار الأقوى</span></h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            كلمة المرور وحدها تكفي من يسرقها. مع التحقّق بخطوتين يحتاج أيضاً إلى جوالك.
          </p>
        </div>

        {verified.length === 0 ? (
          <MfaEnroll />
        ) : (
          <div className="space-y-3">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              ✓ مُفعّل. مستوى الجلسة الحالي: <span dir="ltr">{aal?.currentLevel ?? "—"}</span>
            </p>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {verified.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{f.friendly_name ?? "تطبيق مصادقة"}</p>
                    <p className="text-xs text-neutral-500">
                      أُضيف {new Date(f.created_at).toLocaleDateString("ar-SA")}
                    </p>
                  </div>
                  <form action={removeFactor}>
                    <input type="hidden" name="factor_id" value={f.id} />
                    <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20">
                      إلغاء
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="text-xs text-neutral-500">
              إن فقدت جوالك ولم تستطع الدخول، تواصل معنا — لا يمكن تجاوز التحقّق من داخل النظام، وهذا مقصود.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
