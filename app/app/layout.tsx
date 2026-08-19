import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { daysLeft, type Summary } from "@/lib/subscription";
import { AppSidebar } from "@/components/app-sidebar";
import { MAINTENANCE_OPEN_STATUSES } from "@/lib/maintenance";
import { UpdateBanner } from "@/components/update-banner";
import { ToastProvider } from "@/components/ui";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const activeOrg = await getActiveOrg();
  let orgName: string | null = null;
  let unread = 0;
  let openMaintenance = 0;
  let subBanner: { tone: "amber" | "red"; text: string } | null = null;
  if (activeOrg) {
    const { data } = await supabase
      .from("organization")
      .select("name")
      .eq("id", activeOrg)
      .maybeSingle();
    orgName = data?.name ?? null;
    // Unread notifications badge. Degrades to 0 (no throw) before migration 0034 is applied.
    const { count } = await supabase
      .from("notification")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    unread = count ?? 0;
    // Open maintenance requests for the sidebar badge (0072). Head-count only, and it degrades to
    // 0 rather than throwing for an org whose database has not had 0072 applied yet.
    const { count: openCount } = await supabase
      .from("maintenance_request")
      .select("id", { count: "exact", head: true })
      .in("status", [...MAINTENANCE_OPEN_STATUSES])
      .is("deleted_at", null);
    openMaintenance = openCount ?? 0;
    // Subscription banner: lock notice when inactive, trial countdown in the last week.
    // Degrades to no banner (data null) before migration 0036 is applied.
    const { data: sub } = await supabase.rpc("subscription_summary", { p_org: activeOrg });
    const s = sub as Summary | null;
    if (s && !s.active) {
      subBanner = { tone: "red", text: "انتهى اشتراكك وتوقّف إنشاء عناصر جديدة. بياناتك محفوظة." };
    } else if (s && s.status === "trialing") {
      const d = daysLeft(s.trial_ends_at);
      if (d != null && d <= 7) {
        const when = d <= 0 ? "خلال اليوم" : d === 1 ? "خلال يوم واحد" : d === 2 ? "خلال يومين" : `خلال ${d} أيام`;
        subBanner = { tone: "amber", text: `تنتهي فترتك التجريبية ${when}.` };
      }
    }
  }

  const banner = subBanner && (
    <Link
      href="/app/subscription"
      className={
        "no-print block border-b px-4 py-2 text-center text-sm " +
        (subBanner.tone === "red"
          ? "border-red-200 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
          : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200")
      }
    >
      {subBanner.text} <span className="font-medium underline">إدارة الاشتراك ←</span>
    </Link>
  );

  // With an active org: grouped sidebar (desktop) / drawer (mobile) + shifted content.
  if (activeOrg && orgName) {
    return (
      <ToastProvider>
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
          <AppSidebar orgName={orgName} unread={unread} openMaintenance={openMaintenance} />
          <div className="md:ps-64 print:ps-0">
            {/* Above the subscription banner: a stale bundle is the one thing that can swallow the
                work in progress, so it is read before anything else. */}
            <UpdateBanner />
            {banner}
            <main className="mx-auto max-w-4xl px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">{children}</main>
          </div>
        </div>
      </ToastProvider>
    );
  }

  // No active org yet (create/select org): a minimal top bar, no sidebar.
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <UpdateBanner />
      <header className="no-print border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/app" className="text-lg font-bold">عقار</Link>
          <form action={signOut}>
            <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
              خروج
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
