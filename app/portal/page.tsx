import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OwnerLink = { owner_id: string; org_name: string; display_name: string };
type TenantLink = { tenant_id: string; org_name: string; display_name: string };

export default async function PortalHome() {
  const supabase = await createClient();
  const [{ data: ownerData }, { data: tenantData }] = await Promise.all([
    supabase.rpc("my_owner_links"),
    supabase.rpc("my_tenant_links"),
  ]);
  const owners = (ownerData ?? []) as OwnerLink[];
  const tenants = (tenantData ?? []) as TenantLink[];

  // Exactly one profile total → go straight to it.
  if (owners.length + tenants.length === 1) {
    if (owners.length === 1) redirect(`/portal/${owners[0].owner_id}`);
    redirect(`/portal/tenant/${tenants[0].tenant_id}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">بوابتك</h1>

      {owners.length + tenants.length === 0 ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          لا توجد ملفات مرتبطة بحسابك بعد. إن وصلك رابط دعوة من مكتب الإدارة، افتحه للانضمام.
        </section>
      ) : (
        <>
          {owners.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-neutral-500">كمالك</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {owners.map((l) => (
                  <li key={l.owner_id}>
                    <Link href={`/portal/${l.owner_id}`} className="block rounded-xl border border-neutral-200 px-4 py-3 hover:border-brand dark:border-neutral-800">
                      <span className="font-medium">{l.org_name}</span>
                      <span className="mr-2 text-sm text-neutral-500">· {l.display_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tenants.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-neutral-500">كمستأجر</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {tenants.map((l) => (
                  <li key={l.tenant_id}>
                    <Link href={`/portal/tenant/${l.tenant_id}`} className="block rounded-xl border border-neutral-200 px-4 py-3 hover:border-brand dark:border-neutral-800">
                      <span className="font-medium">{l.org_name}</span>
                      <span className="mr-2 text-sm text-neutral-500">· {l.display_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
