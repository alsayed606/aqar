import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { UnitForm } from "@/components/unit-form";
import { ConfirmButton } from "@/components/confirm-button";
import { FormDrawer } from "@/components/form-drawer";
import { changePropertyOwner } from "../actions";
import { PROPERTY_KIND_AR, UNIT_STATUS_AR, CONTRACT_STATUS_AR } from "@/lib/labels";
import { halalasToSar } from "@/lib/money";
import { Card, CardBody, Badge, Tabs } from "@/components/ui";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ownerLabel = (o: any) =>
  o?.is_self ? "المنشأة (مالك ذاتي)" : first(o?.party)?.display_name ?? "مالك";

const UNIT_TONE: Record<string, "success" | "warning" | "neutral"> = {
  rented: "success",
  vacant: "warning",
};

type UnitRow = {
  id: string;
  unit_number: string;
  floor: string | null;
  area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  current_status: string;
};

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardBody className="p-4 text-center">
        <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardBody>
    </Card>
  );
}

export default async function PropertyDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: flashError } = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const { data: property } = await supabase
    .from("property")
    .select(
      "id, name, property_kind, property_code, city, district, deed_number, owner_id, owner:owner_id(is_self, party:party_id(display_name))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!property) notFound();

  const [{ data: unitData }, { data: ownerData }, { data: contractData }] = await Promise.all([
    supabase
      .from("unit")
      .select("id, unit_number, floor, area_sqm, bedrooms, bathrooms, current_status")
      .eq("property_id", id)
      .is("deleted_at", null)
      .order("unit_number", { ascending: true }),
    supabase
      .from("owner")
      .select("id, is_self, party:party_id(display_name)")
      .is("deleted_at", null)
      .order("is_self", { ascending: false }),
    supabase
      .from("contract")
      .select(
        "id, contract_number, status, start_date, end_date, annual_rent_halalas, unit:unit_id(unit_number), tenant:tenant_id(party:party_id(display_name))",
      )
      .eq("property_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const units = (unitData ?? []) as UnitRow[];
  const owners = ownerData ?? [];
  const contracts = (contractData ?? []) as any[];
  const rented = units.filter((u) => u.current_status === "rented").length;
  const vacant = units.filter((u) => u.current_status === "vacant").length;
  const activeContracts = contracts.filter((c) => c.status === "active").length;

  const unitsTab = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-slate-500">{units.length} وحدة</span>
        <FormDrawer label="إضافة وحدة جديدة" title={`إضافة وحدة — ${property.name}`}>
          <UnitForm propertyId={property.id} />
        </FormDrawer>
      </div>

      {units.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
          لا توجد وحدات بعد. أضِف أول وحدة من الزر أعلاه.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                <th>رقم الوحدة</th>
                <th>الحالة</th>
                <th>الدور</th>
                <th>المساحة</th>
                <th>غرف</th>
                <th>دورات مياه</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {units.map((u) => (
                <tr key={u.id} className="[&>td]:px-4 [&>td]:py-2">
                  <td className="font-medium">{u.unit_number}</td>
                  <td>
                    <Badge tone={UNIT_TONE[u.current_status] ?? "neutral"}>
                      {UNIT_STATUS_AR[u.current_status] ?? u.current_status}
                    </Badge>
                  </td>
                  <td className="text-slate-600 dark:text-slate-300">{u.floor ?? "—"}</td>
                  <td className="text-slate-600 dark:text-slate-300">{u.area_sqm != null ? `${u.area_sqm} م²` : "—"}</td>
                  <td className="text-slate-600 dark:text-slate-300">{u.bedrooms ?? "—"}</td>
                  <td className="text-slate-600 dark:text-slate-300">{u.bathrooms ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const contractsTab =
    contracts.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
        لا توجد عقود مرتبطة بهذا العقار.
      </p>
    ) : (
      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
              <th>رقم العقد</th>
              <th>الوحدة</th>
              <th>المستأجر</th>
              <th>الحالة</th>
              <th>الفترة</th>
              <th>الإيجار السنوي</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {contracts.map((c) => (
              <tr key={c.id} className="[&>td]:px-4 [&>td]:py-2">
                <td className="font-medium" dir="ltr">{c.contract_number}</td>
                <td>{first(c.unit)?.unit_number ?? "—"}</td>
                <td>{first(first(c.tenant)?.party)?.display_name ?? "—"}</td>
                <td>
                  <Badge tone={c.status === "active" ? "success" : "neutral"}>
                    {CONTRACT_STATUS_AR[c.status] ?? c.status}
                  </Badge>
                </td>
                <td className="text-xs text-slate-500" dir="ltr">{c.start_date} → {c.end_date}</td>
                <td>{halalasToSar(c.annual_rent_halalas)} ر.س</td>
                <td>
                  <Link href={`/app/contracts/${c.id}`} className="text-xs text-brand hover:underline">عرض ←</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href="/app/properties" className="hover:text-brand">العقارات</Link>{" "}
        / <span className="text-slate-700 dark:text-slate-300">{property.name}</span>
      </nav>

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>
      )}

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{property.name}</h1>
            <div className="flex items-center gap-2">
              {property.property_code && <Badge tone="neutral">{property.property_code}</Badge>}
              <Badge tone="brand">{PROPERTY_KIND_AR[property.property_kind] ?? property.property_kind}</Badge>
            </div>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {[property.city, property.district].filter(Boolean).join(" · ") || "—"}
          </p>
          {property.deed_number && (
            <p className="mt-1 text-xs text-slate-400" dir="ltr">صك: {property.deed_number}</p>
          )}

          <details className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <summary className="cursor-pointer select-none text-sm font-medium text-slate-600 dark:text-slate-300">
              تغيير مالك العقار
            </summary>
            <form action={changePropertyOwner} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="property_id" value={property.id} />
              <div>
                <label className="mb-1 block text-xs text-slate-500" htmlFor="owner_id">المالك</label>
                <select
                  id="owner_id"
                  name="owner_id"
                  defaultValue={property.owner_id}
                  className="rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-slate-700"
                >
                  {owners.map((o: any) => (
                    <option key={o.id} value={o.id}>{ownerLabel(o)}</option>
                  ))}
                </select>
              </div>
              <ConfirmButton
                message="تغيير مالك العقار قد يؤثّر على العقود والالتزامات المالية والبيانات المرتبطة به. هل تريد المتابعة؟"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                حفظ المالك
              </ConfirmButton>
              <span className="self-center text-xs text-slate-400">الحالي: {ownerLabel((property as any).owner)}</span>
              <p className="w-full text-xs text-amber-600 dark:text-amber-500">
                ⚠️ تغيير المالك قد يؤثّر على العقود والالتزامات المالية المرتبطة بالعقار.
              </p>
            </form>
          </details>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="إجمالي الوحدات" value={units.length} />
        <Kpi label="مؤجرة" value={rented} />
        <Kpi label="شاغرة" value={vacant} />
        <Kpi label="عقود نشطة" value={activeContracts} />
      </div>

      <Tabs
        items={[
          { id: "units", label: `الوحدات (${units.length})`, content: unitsTab },
          { id: "contracts", label: `العقود (${contracts.length})`, content: contractsTab },
        ]}
      />
    </div>
  );
}
