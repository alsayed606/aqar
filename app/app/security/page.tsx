import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaEnroll } from "@/components/mfa-enroll";
import { EmailMfaEnroll } from "@/components/email-mfa-enroll";
import { RecoveryCodes } from "@/components/recovery-codes";
import { emailFactorState } from "@/lib/mfa";
import { maskEmail } from "@/lib/mfa-server";
import { removeFactor, disableEmailMfa, removeLostAuthenticator } from "./actions";

export const dynamic = "force-dynamic";

const OK_AR: Record<string, string> = {
  enrolled: "فُعّل التحقّق بخطوتين. ستُطلب منك رمزاً عند كل تسجيل دخول.",
  removed: "أُلغي التحقّق بخطوتين.",
  email_enrolled: "فُعّل التحقّق برمز البريد. سيصلك رمز عند كل تسجيل دخول من جهاز جديد.",
  email_removed: "أُلغي التحقّق برمز البريد.",
  totp_recovered: "أُزيل تطبيق المصادقة المفقود. فعّل وسيلة تحقّق جديدة الآن لتبقى محمياً.",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; recovery?: string; returnTo?: string }>;
}) {
  const { ok, error, recovery, returnTo } = await searchParams;
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

      {/* The restricted session (migration 0071): an e-mail code stood in for an authenticator the
          user cannot reach. Said plainly, because a page that silently refuses every link in the
          sidebar reads as a broken app rather than as a deliberate limit. */}
      {email.restricted && (
        <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p>
            <b>أنت في وضع الاسترداد.</b> دخلت برمز أُرسل إلى بريدك بدلاً من تطبيق المصادقة، وهذا
            إثبات أضعف — فلن تُفتح لك بقية الصفحات حتى تُزيل التطبيق المفقود أو تُسجّل غيره.
          </p>
          {verified.length > 0 && (
            <form action={removeLostAuthenticator}>
              <button className="rounded-lg bg-amber-700 px-4 py-2 font-medium text-white hover:bg-amber-800">
                إزالة تطبيق المصادقة المفقود
              </button>
            </form>
          )}
        </div>
      )}

      {/* Arrived here after spending one of the ten. */}
      {recovery === "used" && !email.restricted && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          استُخدم رمز استرداد. ولّد قائمة جديدة أدناه إن أردت، أو{" "}
          <a className="underline" href={returnTo && returnTo.startsWith("/") ? returnTo : "/app"}>
            تابع إلى النظام
          </a>
          .
        </p>
      )}

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
          <p className="mt-1 text-xs text-neutral-500">
            يلزمك تطبيق مصادقة على جوالك قبل التفعيل، مثل Google Authenticator أو Microsoft Authenticator أو Authy.
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
              إن فقدت جوالك، فرموز الاسترداد أدناه هي طريقك للعودة. بدونها يبقى الطريق الأضعف:
              رمز يُرسَل إلى بريدك ويفتح صفحة الأمان فقط.
            </p>
          </div>
        )}
      </section>

      {/* Third, because it only means anything once one of the two above is on. */}
      <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <h2 className="text-lg font-semibold">رموز الاسترداد</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            عشرة رموز تُعرض <b>مرّة واحدة</b>، كل واحد يُستخدم مرّة. احفظها خارج جوالك — ورقة في
            الدرج، أو مدير كلمات مرور. هي ما يعيدك إلى حسابك لو ضاع الجوال أو حُذف التطبيق.
          </p>
        </div>
        <RecoveryCodes codesLeft={email.codesLeft} hasFactor={anyFactor} />
      </section>
    </div>
  );
}
