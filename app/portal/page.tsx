import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OwnerLink = {
  owner_id: string;
  org_id: string;
  org_name: string;
  display_name: string;
};

export default async function PortalHome() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_owner_links");
  const links = (data ?? []) as OwnerLink[];

  if (links.length === 1) redirect(`/portal/${links[0].owner_id}`);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">بوابة المالك</h1>

      {links.length === 0 ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          لا توجد ملفات مالك مرتبطة بحسابك بعد. إن وصلك رابط دعوة من مكتب الإدارة، افتحه للانضمام.
        </section>
      ) : (
        <section>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">اختر المكتب لعرض كشوفك:</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {links.map((l) => (
              <li key={l.owner_id}>
                <Link
                  href={`/portal/${l.owner_id}`}
                  className="block rounded-xl border border-neutral-200 px-4 py-3 hover:border-brand dark:border-neutral-800"
                >
                  <span className="font-medium">{l.org_name}</span>
                  <span className="mr-2 text-sm text-neutral-500">· {l.display_name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
