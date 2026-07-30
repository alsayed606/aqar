import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { updateTenant } from "../actions";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const cls = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

const TYPE_AR: Record<string, string> = { individual: "فرد", sole_establishment: "مؤسسة فردية", company: "شركة" };

export default async function TenantEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error: flashError } = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const caps = await getCapabilities(activeOrg);
  const canEdit = caps.has("manage_data");

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenant")
    .select("id, tenant_type, party:party_id(id, display_name, legal_kind, national_id, email, phone_e164, cr_number, vat_number, unified_number, cr_expiry)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!tenant) notFound();
  const p = first((tenant as any).party);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/tenants" className="hover:text-brand">المستأجرون</Link> /{" "}
        <span className="text-neutral-700 dark:text-neutral-300">{p?.display_name}</span>
      </nav>

      {ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">حُفظت التعديلات.</p>}
      {flashError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>}

      {!canEdit ? (
        <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          تعديل المستأجرين متاح لمن يملك صلاحية إدارة البيانات. النوع الحالي: {TYPE_AR[(tenant as any).tenant_type] ?? "—"}.
        </p>
      ) : (
        <form action={updateTenant} className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <input type="hidden" name="tenant_id" value={tenant.id} />
          <input type="hidden" name="party_id" value={p?.id} />
          <h1 className="text-lg font-semibold">تعديل المستأجر</h1>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">الاسم *</label>
              <input name="display_name" required defaultValue={p?.display_name ?? ""} className={cls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">النوع</label>
              <select name="tenant_type" defaultValue={(tenant as any).tenant_type} className={cls}>
                <option value="individual">فرد</option>
                <option value="sole_establishment">مؤسسة فردية</option>
                <option value="company">شركة</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">الجوال</label>
              <input name="phone" dir="ltr" defaultValue={p?.phone_e164 ?? ""} className={cls + " text-right"} />
            </div>
          </div>

          <details open className="rounded-lg border border-neutral-200 dark:border-neutral-800">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
              تفاصيل إضافية
            </summary>
            <div className="grid gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 dark:border-neutral-800">
              <div>
                <label className="mb-1 block text-sm font-medium">رقم الهوية / الإقامة</label>
                <input name="national_id" dir="ltr" defaultValue={p?.national_id ?? ""} className={cls + " text-right"} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">البريد الإلكتروني</label>
                <input name="email" type="email" dir="ltr" defaultValue={p?.email ?? ""} className={cls + " text-right"} />
              </div>
              <div className="sm:col-span-2 mt-1 text-xs font-medium text-neutral-500">بيانات المنشأة (للمؤسسة/الشركة)</div>
              <div>
                <label className="mb-1 block text-sm font-medium">السجل التجاري</label>
                <input name="cr_number" dir="ltr" defaultValue={p?.cr_number ?? ""} className={cls + " text-right"} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">الرقم الموحّد</label>
                <input name="unified_number" dir="ltr" defaultValue={p?.unified_number ?? ""} className={cls + " text-right"} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">الرقم الضريبي</label>
                <input name="vat_number" dir="ltr" defaultValue={p?.vat_number ?? ""} className={cls + " text-right"} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">تاريخ انتهاء السجل</label>
                <input name="cr_expiry" type="date" dir="ltr" defaultValue={p?.cr_expiry ?? ""} className={cls} />
              </div>
            </div>
          </details>

          <button className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg">حفظ التعديلات</button>
        </form>
      )}
    </div>
  );
}
