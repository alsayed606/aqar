import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailFactorState, mfaStatus } from "@/lib/mfa";
import { maskEmail } from "@/lib/mfa-server";
import { MfaChallengeForm } from "@/components/mfa-challenge-form";
import { EmailOtpForm } from "@/components/email-otp-form";
import { MfaRecoveryOptions } from "@/components/mfa-recovery-options";

export const dynamic = "force-dynamic";

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; method?: string }>;
}) {
  const { returnTo, method } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const totp = await mfaStatus(supabase);
  const email = await emailFactorState(supabase);
  const needsEmail = email.enabled && !email.steppedUp && email.destination;

  // Already stepped up, or nothing to step up to — either way this screen has no business showing.
  if (!totp.stepUpRequired && !needsEmail) {
    redirect(returnTo && returnTo.startsWith("/") ? returnTo : "/app");
  }

  // WHICH FACTOR IS ASKED FOR FIRST
  //
  // The e-mail code leads whenever it is enrolled, even on an account that also has an authenticator
  // app. This reverses the earlier rule ("the stronger factor wins") on the owner's decision: almost
  // every user of this product is a property office, the inbox is already open on the same screen,
  // and a code they copy and paste is the step they will actually complete. The app stays available
  // for whoever prefers it — as a link, not as an imposition.
  //
  // Note the middleware never enforced the old precedence anyway: it accepts ANY step-up on the
  // session, so this page was the only thing choosing. Now it chooses differently.
  const canUseTotp = totp.stepUpRequired;
  const canUseEmail = Boolean(needsEmail);
  const showTotp = canUseTotp && (method === "totp" || !canUseEmail);

  const backTo = returnTo ?? "";
  const switchHref = (to: "totp" | "email") =>
    `/auth/mfa?method=${to}${backTo ? `&returnTo=${encodeURIComponent(backTo)}` : ""}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="text-center">
          <h1 className="text-lg font-bold">التحقّق بخطوتين</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {showTotp
              ? "أدخل الرمز الظاهر في تطبيق المصادقة لديك."
              : "سنرسل رمزاً من ستّة أرقام إلى بريدك، صالحاً لعشر دقائق."}
          </p>
        </div>

        {showTotp ? (
          <>
            <MfaChallengeForm returnTo={backTo} />
            {/* The way back out of the authenticator, for the phone that is gone. */}
            <MfaRecoveryOptions returnTo={backTo} hasEmail={!!user.email} />
          </>
        ) : (
          <EmailOtpForm returnTo={backTo} masked={maskEmail(email.destination!)} />
        )}

        {/* Offered only when the other factor is genuinely usable on this account. Without it, a user
            whose inbox is unreachable right now — or whose mail provider is refusing us — would be
            stuck on a screen that can only wait for an e-mail. */}
        {canUseTotp && canUseEmail && (
          <Link
            href={switchHref(showTotp ? "email" : "totp")}
            className="block text-center text-sm text-brand underline-offset-4 hover:underline"
          >
            {showTotp ? "أرسل الرمز إلى بريدي بدلاً من ذلك" : "استخدم تطبيق المصادقة بدلاً من ذلك"}
          </Link>
        )}
      </div>
    </main>
  );
}
