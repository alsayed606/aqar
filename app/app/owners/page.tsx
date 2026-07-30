import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { OwnerForm } from "@/components/owner-form";
import { first } from "@/lib/rows";
import { parseListParams, likePattern } from "@/lib/list-params";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FormDrawer } from "@/components/form-drawer";
import { OwnersGrid } from "@/components/owners-grid";
import type { OwnerCardData } from "@/components/owner-card";

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
    .select("id, is_self, owner_kind, iban, bank_name, party:party_id!inner(display_name, national_id, phone_e164)", {
      count: "exact",
    })
    .is("deleted_at", null);
  if (q) query = query.ilike("party.display_name", likePattern(q));
  const [{ data, error, count }, { data: propertyData }] = await Promise.all([
    query.order("is_self", { ascending: false }).range(from, to),
    supabase.from("property").select("owner_id").is("deleted_at", null),
  ]);

  const total = count ?? 0;
  const propertiesPerOwner = new Map<string, number>();
  for (const property of propertyData ?? []) {
    propertiesPerOwner.set(property.owner_id, (propertiesPerOwner.get(property.owner_id) ?? 0) + 1);
  }

  const owners: OwnerCardData[] = (data ?? []).map((o: any) => {
    const p = first(o.party);
    return {
      id: o.id,
      display_name: p?.display_name ?? "مالك",
      is_self: o.is_self,
      owner_kind: o.owner_kind ?? "individual",
      national_id: p?.national_id ?? null,
      phone_e164: p?.phone_e164 ?? null,
      iban: o.iban ?? null,
      bank_name: o.bank_name ?? null,
      property_count: propertiesPerOwner.get(o.id) ?? 0,
    };
  });

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
          <OwnersGrid owners={owners} />
          <Pagination page={page} total={total} q={q} basePath="/app/owners" />
        </>
      )}
    </div>
  );
}
