import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { Badge } from "@/components/ui";
import { MaintenanceInspector, type MaintenanceRow } from "@/components/maintenance-inspector";
import { maintenanceUrgencyTone } from "@/lib/maintenance";
import { MAINTENANCE_URGENCY_AR, MAINTENANCE_CATEGORY_AR } from "@/lib/labels";
import { first } from "@/lib/rows";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Triage: the list on one side, the request being worked on the other.
//
// A maintenance request is an operational object that ends when it is resolved — it does not deserve
// a page of its own with its own URL to be bookmarked and returned to. The selection lives in the
// query string so the office can still send a colleague a link to one specific job.

const BUCKETS = [
  { id: "open", label: "مفتوحة", statuses: ["open"] },
  { id: "in_progress", label: "قيد التنفيذ", statuses: ["in_progress"] },
  { id: "closed", label: "مغلقة", statuses: ["resolved", "cancelled"] },
] as const;

function sinceAr(iso: string): string {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "الآن";
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "منذ يوم" : `منذ ${days} أيام`;
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; id?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { tab, id } = await searchParams;
  const bucket = BUCKETS.find((b) => b.id === tab) ?? BUCKETS[0];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_request")
    .select(
      "id, request_no, status, urgency, category, description, assignee_name, vendor_name, estimated_cost_halalas, cost_bearer, resolution_note, photo_path, created_at, unit:unit_id(unit_number), property:property_id(name), reporter:reported_by_party_id(display_name)",
    )
    .is("deleted_at", null)
    // Emergency first, then urgent, then by age: the queue is read top-down under pressure.
    .order("urgency", { ascending: false })
    .order("created_at", { ascending: true });

  const all = ((data ?? []) as any[]).map<MaintenanceRow>((r) => ({
    id: r.id,
    request_no: r.request_no,
    status: r.status,
    urgency: r.urgency,
    category: r.category,
    description: r.description,
    unit_number: first(r.unit)?.unit_number ?? null,
    property_name: first(r.property)?.name ?? null,
    reporter_name: first(r.reporter)?.display_name ?? null,
    assignee_name: r.assignee_name,
    vendor_name: r.vendor_name,
    estimated_cost_halalas: r.estimated_cost_halalas,
    cost_bearer: r.cost_bearer,
    resolution_note: r.resolution_note,
    photo_path: r.photo_path,
    created_at: r.created_at,
  }));

  const shown = all.filter((r) => (bucket.statuses as readonly string[]).includes(r.status));
  const countOf = (b: (typeof BUCKETS)[number]) =>
    all.filter((r) => (b.statuses as readonly string[]).includes(r.status)).length;
  // Selecting nothing shows the first of the list rather than an empty panel telling you to choose.
  const selected = shown.find((r) => r.id === id) ?? shown[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">طلبات الصيانة</h1>
        <span className="text-sm text-slate-500">{countOf(BUCKETS[0])} مفتوحة</span>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          تعذّر تحميل الطلبات: {error.message}
        </p>
      ) : (
        <>
          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
            {BUCKETS.map((b) => (
              <Link
                key={b.id}
                role="tab"
                aria-selected={b.id === bucket.id}
                href={`/app/maintenance?tab=${b.id}`}
                className={
                  "-mb-px whitespace-nowrap px-4 py-2.5 text-sm font-medium " +
                  (b.id === bucket.id
                    ? "border-b-2 border-brand text-brand"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")
                }
              >
                {b.label} <span className="text-xs text-slate-400">({countOf(b)})</span>
              </Link>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
              لا توجد طلبات في هذا التصنيف.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <ul className="space-y-2">
                {shown.map((r) => {
                  const isSelected = selected?.id === r.id;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/app/maintenance?tab=${bucket.id}&id=${r.id}`}
                        className={
                          "block rounded-xl border p-3 transition-colors " +
                          (isSelected
                            ? "border-brand bg-brand/5"
                            : "border-slate-200 hover:border-brand/40 dark:border-slate-800")
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium">
                            {MAINTENANCE_CATEGORY_AR[r.category] ?? r.category} — {r.description.slice(0, 40)}
                          </span>
                          <Badge tone={maintenanceUrgencyTone(r.urgency)}>{MAINTENANCE_URGENCY_AR[r.urgency] ?? r.urgency}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {r.property_name ?? "—"} • وحدة {r.unit_number ?? "—"} · {sinceAr(r.created_at)}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {selected && <MaintenanceInspector key={selected.id} request={selected} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
