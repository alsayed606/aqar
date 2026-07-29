import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { OwnerForm } from "@/components/owner-form";
import { first } from "@/lib/rows";
import { parseListParams, likePattern } from "@/lib/list-params";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FilterableCards } from "@/components/filterable-list";
import { FormDrawer } from "@/components/form-drawer";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to } = parseListParams(await searchParams);

  const supabase = await createClient();
  let query = supabase
    .from("owner")
    .select("id, is_self, iban, party:party_id!inner(display_name, national_id, phone_e164)", {
      count: "exact",
    })
    .is("deleted_at", null);
  if (q) query = query.ilike("party.display_name", likePattern(q));
  const { data, error, count } = await query.order("is_self", { ascending: false }).range(from, to);

  const owners = data ?? [];
  const total = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">الملّاك</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{total}</span>
          <FormDrawer label="إضافة مالك" title="إضافة مالك">
            <OwnerForm />
          </FormDrawer>
        </div>
      </div>

      <ListToolbar q={q} placeholder="بحث باسم المالك…" />

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر التحميل: {error.message}
        </p>
      ) : owners.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا يوجد ملّاك بعد."}
        </p>
      ) : (
        <>
          <FilterableCards
            placeholder="تصفية سريعة في هذه الصفحة…"
            className="grid gap-3 sm:grid-cols-2"
            items={owners.map((o: any) => {
              const p = first(o.party);
              return {
                id: o.id,
                search: [o.is_self ? "المنشأة مالك ذاتي" : p?.display_name, p?.phone_e164, p?.national_id].filter(Boolean).join(" "),
                node: (
                  <Link
                    href={`/app/owners/${o.id}`}
                    className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{o.is_self ? "المنشأة (مالك ذاتي)" : p?.display_name}</p>
                      {o.is_self && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">ذاتي</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500" dir="ltr">{p?.phone_e164 ?? p?.national_id ?? ""}</p>
                    <p className="mt-1 text-xs text-slate-400">كشف الحساب ←</p>
                  </Link>
                ),
              };
            })}
          />
          <Pagination page={page} total={total} q={q} basePath="/app/owners" />
        </>
      )}
    </div>
  );
}
