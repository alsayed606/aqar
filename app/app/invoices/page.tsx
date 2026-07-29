import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { DOC_KIND_AR } from "@/lib/labels";
import { parseListParams, likePattern } from "@/lib/list-params";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FilterableTable } from "@/components/filterable-list";

export const dynamic = "force-dynamic";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  invoice_type: string;
  doc_kind: string;
  issue_at: string;
  buyer_name: string | null;
  total_incl_vat_halalas: number;
  total_vat_halalas: number;
  status: string;
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to } = parseListParams(await searchParams);

  const supabase = await createClient();
  let query = supabase
    .from("invoice")
    .select(
      "id, invoice_no, invoice_type, doc_kind, issue_at, buyer_name, total_incl_vat_halalas, total_vat_halalas, status",
      { count: "exact" },
    )
    .is("deleted_at", null);
  if (q) query = query.ilike("invoice_no", likePattern(q));
  const { data, count } = await query.order("issue_at", { ascending: false }).range(from, to);

  const rows = (data ?? []) as InvoiceRow[];
  const total = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الفواتير</h1>
        <span className="text-sm text-neutral-500">{total} فاتورة</span>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        تُصدَر الفاتورة من صفحة العقد لكل استحقاق. الفاتورة توثّق التوريد وضريبته — مستقلّة عن السداد (يُثبت السداد بسند القبض).
      </p>

      <ListToolbar q={q} placeholder="بحث برقم الفاتورة…" />

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا توجد فواتير بعد. افتح عقداً فعّالاً وأصدر فاتورة لأحد الاستحقاقات."}
        </p>
      ) : (
        <>
          <FilterableTable
            placeholder="تصفية سريعة في هذه الصفحة…"
            headers={
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                <th>رقم الفاتورة</th>
                <th>التاريخ</th>
                <th>المشتري</th>
                <th>النوع</th>
                <th>الحالة</th>
                <th>الضريبة (ر.س)</th>
                <th>الإجمالي (ر.س)</th>
                <th></th>
              </tr>
            }
            rows={rows.map((r) => {
              const date = new Date(r.issue_at).toISOString().slice(0, 10);
              const kindLabel = (DOC_KIND_AR[r.doc_kind] ?? "فاتورة") + (r.doc_kind === "invoice" ? (r.invoice_type === "plain" ? " عادية" : " ضريبية") : "");
              return {
                id: r.id,
                search: [r.invoice_no, r.buyer_name, date, kindLabel, r.status === "cancelled" ? "ملغاة" : "سارية"].filter(Boolean).join(" "),
                cells: (
                  <>
                    <td className="px-4 py-2 font-mono font-medium" dir="ltr">{r.invoice_no ?? "—"}</td>
                    <td className="px-4 py-2" dir="ltr">{date}</td>
                    <td className="px-4 py-2">{r.buyer_name ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{kindLabel}</td>
                    <td className="px-4 py-2 text-xs">
                      {r.status === "cancelled" ? <span className="text-red-600 dark:text-red-400">ملغاة</span> : <span className="text-slate-500">سارية</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{halalasToSar(r.total_vat_halalas)}</td>
                    <td className="px-4 py-2 font-medium">{halalasToSar(r.total_incl_vat_halalas)}</td>
                    <td className="px-4 py-2">
                      <Link href={`/app/invoices/${r.id}`} className="text-brand hover:underline">عرض / طباعة ←</Link>
                    </td>
                  </>
                ),
              };
            })}
          />
          <Pagination page={page} total={total} q={q} basePath="/app/invoices" />
        </>
      )}
    </div>
  );
}
