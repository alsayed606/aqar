import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mfaStatus } from "@/lib/mfa";
import { MfaChallengeForm } from "@/components/mfa-challenge-form";

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

  // Already stepped up, or nothing to step up to — either way this screen has no business showing.
  const status = await mfaStatus(supabase);
  if (!status.stepUpRequired) redirect(returnTo && returnTo.startsWith("/") ? returnTo : "/app");

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="text-center">
          <h1 className="text-lg font-bold">التحقّق بخطوتين</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            أدخل الرمز الظاهر في تطبيق المصادقة لديك.
          </p>
        </div>
        <MfaChallengeForm returnTo={returnTo ?? ""} />
      </div>
    </main>
  );
}
