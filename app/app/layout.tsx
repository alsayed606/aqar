import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
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
  if (activeOrg) {
    const { data } = await supabase
      .from("organization")
      .select("name")
      .eq("id", activeOrg)
      .maybeSingle();
    orgName = data?.name ?? null;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
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
                <Link href="/app/tenants" className="hover:text-brand">
                  المستأجرون
                </Link>
                <Link href="/app/contracts" className="hover:text-brand">
                  العقود
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
      <div className="mx-auto max-w-4xl px-4 py-6">{children}</div>
    </div>
  );
}
