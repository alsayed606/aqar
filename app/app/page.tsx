import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { switchOrg } from "./actions";
import { CreateOrgForm } from "@/components/create-org-form";
import { Dashboard } from "@/components/dashboard";
import { ROLE_AR } from "@/lib/labels";

export const dynamic = "force-dynamic";

type MembershipRow = {
  id: string;
  org_id: string;
  role: string;
  organization: { name: string } | { name: string }[] | null;
};

export default async function AppHome() {
  const supabase = await createClient();
  const activeOrg = await getActiveOrg();

  const { data } = await supabase
    .from("membership")
    .select("id, org_id, role, organization(name)")
    .eq("status", "active");

  const memberships = (data ?? []) as MembershipRow[];
  const orgName = (m: MembershipRow) =>
    (Array.isArray(m.organization) ? m.organization[0]?.name : m.organization?.name) ??
    "منشأة";

  const { data: ownerLinks } = await supabase.rpc("my_owner_links");
  const hasOwnerLinks = (ownerLinks ?? []).length > 0;

  return (
    <div className="space-y-6">
      {activeOrg && <Dashboard />}

      {hasOwnerLinks && (
        <Link
          href="/portal"
          className="block rounded-2xl border border-brand/30 bg-brand/5 p-4 text-sm hover:border-brand dark:bg-brand/10"
        >
          <span className="font-medium">بوابة المالك</span> — لك ملفات مالك لدى مكتب إدارة. اطّلع على كشوفك وتوريداتك ←
        </Link>
      )}

      {memberships.length === 0 ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-1 text-lg font-semibold">أنشئ منشأتك للبدء</h2>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            لست عضواً في أي منشأة بعد. أنشئ مكتبك لتبدأ.
          </p>
          <CreateOrgForm />
        </section>
      ) : (
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-4 text-lg font-semibold">منشآتك</h2>
          <ul className="space-y-2">
            {memberships.map((m) => {
              const isActive = m.org_id === activeOrg;
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-neutral-100 px-4 py-3 dark:border-neutral-800"
                >
                  <div>
                    <p className="font-medium">{orgName(m)}</p>
                    <p className="text-xs text-neutral-500">{ROLE_AR[m.role] ?? m.role}</p>
                  </div>
                  {isActive ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      المنشأة النشطة
                    </span>
                  ) : (
                    <form action={switchOrg}>
                      <input type="hidden" name="orgId" value={m.org_id} />
                      <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                        التبديل إليها
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-6 border-t border-neutral-100 pt-6 dark:border-neutral-800">
            <h3 className="mb-3 text-sm font-medium text-neutral-500">إنشاء منشأة أخرى</h3>
            <CreateOrgForm />
          </div>
        </section>
      )}
    </div>
  );
}
