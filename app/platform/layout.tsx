import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlatformSidebar } from "@/components/platform/platform-sidebar";

export const dynamic = "force-dynamic";

/**
 * The platform console shell. Next.js allows exactly one middleware per app, so the separation the
 * console needs is enforced here instead: this layout is the gate every page under /platform passes
 * through, and it asks the database — not a cookie, not a claim — whether the caller is an operator.
 * The middleware only handles the unauthenticated redirect.
 *
 * A non-operator gets notFound() rather than a refusal: the console does not advertise its own
 * existence to accounts that have no business knowing about it.
 *
 * Nothing here reads the active-org cookie or renders anything from the office app, so no office
 * state can leak into this space — and RLS still governs every read underneath, because the platform
 * functions are the only path to cross-office data (ADR-0006).
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/platform");

  const { data: isOperator } = await supabase.rpc("is_platform_operator");
  if (!isOperator) notFound();

  // An operator account can see every office on the platform, so a password alone is not enough to
  // hold it. Unlike the office app — where two-factor is the user's own choice — it is required
  // here, and the console stays shut until it is on. The middleware already steps up an operator who
  // HAS a factor; this covers the one it cannot: an operator who has never enrolled.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!(factors?.totp ?? []).some((f) => f.status === "verified")) {
    redirect("/app/security?error=" + encodeURIComponent("لوحة الإدارة العليا تتطلّب تفعيل التحقّق بخطوتين أولاً."));
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <PlatformSidebar operatorLabel={user.email ?? user.phone ?? null} />
      <div className="md:pr-64 print:pr-0">
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
