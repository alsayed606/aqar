import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { TenantForm } from "@/components/tenant-form";
import { TenantPortalInvite } from "@/components/tenant-portal-invite";

export const dynamic = "force-dynamic";

type TenantRow = {
  id: string;
  party: { display_name: string; national_id: string | null; phone_e164: string | null } | { display_name: string; national_id: string | null; phone_e164: string | null }[] | null;
};

function party(t: TenantRow) {
  return Array.isArray(t.party) ? t.party[0] : t.party;
}

export default async function TenantsPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant")
    .select("id, party:party_id(display_name, national_id, phone_e164)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const tenants = (data ?? []) as TenantRow[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">المستأجرون</h1>
        <span className="text-sm text-neutral-500">{tenants.length} مستأجر</span>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-base font-semibold">إضافة مستأجر</h2>
        <TenantForm />
      </section>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل المستأجرين: {error.message}
        </p>
      ) : tenants.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          لا يوجد مستأجرون بعد. أضِف أول مستأجر من النموذج أعلاه.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 text-right font-medium">الاسم</th>
                <th className="px-4 py-2 text-right font-medium">رقم الهوية / الإقامة</th>
                <th className="px-4 py-2 text-right font-medium">الجوال</th>
                <th className="px-4 py-2 text-right font-medium">بوابة المستأجر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {tenants.map((t) => {
                const p = party(t);
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-2 font-medium">{p?.display_name}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300" dir="ltr">
                      {p?.national_id ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300" dir="ltr">
                      {p?.phone_e164 ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <TenantPortalInvite tenantId={t.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
