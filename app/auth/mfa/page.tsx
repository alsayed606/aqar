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
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Two factors can gate a session: Supabase's TOTP and our e-mail code (0069). TOTP wins when both
  // are set up — it is the stronger of the two, and someone who went to the trouble of an
  // authenticator app should not be handed the weaker option instead.
  const totp = await mfaStatus(supabase);
  const email = await emailFactorState(supabase);
  const needsEmail = email.enabled && !email.steppedUp && email.destination;

  // Already stepped up, or nothing to step up to — either way this screen has no business showing.
  if (!totp.stepUpRequired && !needsEmail) {
    redirect(returnTo && returnTo.startsWith("/") ? returnTo : "/app");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="text-center">
          <h1 className="text-lg font-bold">التحقّق بخطوتين</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {totp.stepUpRequired
              ? "أدخل الرمز الظاهر في تطبيق المصادقة لديك."
              : "سنرسل رمزاً من ستّة أرقام إلى بريدك، صالحاً لعشر دقائق."}
          </p>
        </div>
        {totp.stepUpRequired ? (
          <>
            <MfaChallengeForm returnTo={returnTo ?? ""} />
            {/* Only under TOTP. The e-mail factor already resends to an inbox the user has, so it
                needs no way around itself — and offering one would be a way around nothing. */}
            <MfaRecoveryOptions returnTo={returnTo ?? ""} hasEmail={!!user.email} />
          </>
        ) : (
          <EmailOtpForm returnTo={returnTo ?? ""} masked={maskEmail(email.destination!)} />
        )}
      </div>
    </main>
  );
}
