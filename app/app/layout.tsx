import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { daysLeft, type Summary } from "@/lib/subscription";
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

  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-5">
            <Link href="/app" className="text-lg font-bold">
              عقار
            </Link>
            {activeOrg && orgName && (
              <nav className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-300">
                <Link href="/app" className="hover:text-brand">
                  الرئيسية
                </Link>
                <Link href="/app/properties" className="hover:text-brand">
                  العقارات
                </Link>
                <Link href="/app/owners" className="hover:text-brand">
                  الملّاك
                </Link>
                <Link href="/app/tenants" className="hover:text-brand">
                  المستأجرون
                </Link>
                <Link href="/app/contracts" className="hover:text-brand">
                  العقود
                </Link>
                <Link href="/app/invoices" className="hover:text-brand">
                  الفواتير
                </Link>
                <Link href="/app/receipts" className="hover:text-brand">
                  السندات
                </Link>
                <Link href="/app/import" className="hover:text-brand">
                  الاستيراد
                </Link>
                <Link href="/app/team" className="hover:text-brand">
                  الفريق
                </Link>
                <Link href="/app/notifications" className="relative hover:text-brand">
                  الإشعارات
                  {unread > 0 && (
                    <span className="mr-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Link>
                <Link href="/app/subscription" className="hover:text-brand">
                  الاشتراك
                </Link>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3">
            {orgName && (
              <span className="hidden text-sm text-neutral-500 sm:inline">{orgName}</span>
            )}
            <form action={signOut}>
              <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>
      {subBanner && (
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
      )}
      <div className="mx-auto max-w-4xl px-4 py-6">{children}</div>
    </div>
  );
}
