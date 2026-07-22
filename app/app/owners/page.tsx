import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { OwnerForm } from "@/components/owner-form";
import { first } from "@/lib/rows";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OwnersPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("owner")
    .select("id, is_self, iban, party:party_id(display_name, national_id, phone_e164)")
    .is("deleted_at", null)
    .order("is_self", { ascending: false });

  const owners = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الملّاك</h1>
        <span className="text-sm text-neutral-500">{owners.length}</span>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-base font-semibold">إضافة مالك</h2>
        <OwnerForm />
      </section>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر التحميل: {error.message}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {owners.map((o: any) => {
            const p = first(o.party);
            return (
              <li key={o.id}>
                <Link
                  href={`/app/owners/${o.id}`}
                  className="block rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-brand dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">
                      {o.is_self ? "المنشأة (مالك ذاتي)" : p?.display_name}
                    </p>
                    {o.is_self && (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        ذاتي
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-neutral-500" dir="ltr">
                    {p?.phone_e164 ?? p?.national_id ?? ""}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400">كشف الحساب ←</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
