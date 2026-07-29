import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { first } from "@/lib/rows";
import { parseListParams, likePattern } from "@/lib/list-params";
import { ListToolbar } from "@/components/list-toolbar";
import { Pagination } from "@/components/pagination";
import { FilterableTable } from "@/components/filterable-list";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type PaymentRow = {
  id: string;
  receipt_no: string | null;
  amount_halalas: number;
  method: string;
  received_at: string;
  party: any;
};

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const { q, page, from, to } = parseListParams(await searchParams);

  const supabase = await createClient();
  let query = supabase
    .from("payment")
    .select("id, receipt_no, amount_halalas, method, received_at, party:party_id(display_name)", {
      count: "exact",
    })
    .is("deleted_at", null);
  if (q) query = query.ilike("receipt_no", likePattern(q));
  const { data, count } = await query.order("received_at", { ascending: false }).range(from, to);

  const rows = (data ?? []) as PaymentRow[];
  const total = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">سندات القبض</h1>
        <span className="text-sm text-neutral-500">{total} سند</span>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        لكل دفعة مستلمة سند قبض مرقّم — إثبات للتحصيل (نقداً أو تحويلاً). سجّل الدفعات من صفحة العقد، وتظهر هنا.
      </p>

      <ListToolbar q={q} placeholder="بحث برقم السند…" />

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
          {q ? "لا توجد نتائج مطابقة للبحث." : "لا توجد دفعات مسجّلة بعد. سجّل دفعة من صفحة العقد لإصدار أول سند قبض."}
        </p>
      ) : (
        <>
          <FilterableTable
            placeholder="تصفية سريعة في هذه الصفحة…"
            headers={
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-right [&>th]:font-medium">
                <th>رقم السند</th>
                <th>التاريخ</th>
                <th>المستلم منه</th>
                <th>المبلغ (ر.س)</th>
                <th>الطريقة</th>
                <th></th>
              </tr>
            }
            rows={rows.map((p) => {
              const date = new Date(p.received_at).toISOString().slice(0, 10);
              const payer = first(p.party)?.display_name ?? "";
              const methodLabel = PAYMENT_METHOD_AR[p.method] ?? p.method;
              return {
                id: p.id,
                search: [p.receipt_no, payer, date, methodLabel].filter(Boolean).join(" "),
                cells: (
                  <>
                    <td className="px-4 py-2 font-mono font-medium" dir="ltr">{p.receipt_no ?? "—"}</td>
                    <td className="px-4 py-2" dir="ltr">{date}</td>
                    <td className="px-4 py-2">{payer || "—"}</td>
                    <td className="px-4 py-2 font-medium">{halalasToSar(p.amount_halalas)}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{methodLabel}</td>
                    <td className="px-4 py-2">
                      <Link href={`/app/receipts/${p.id}`} className="text-brand hover:underline">عرض / طباعة ←</Link>
                    </td>
                  </>
                ),
              };
            })}
          />
          <Pagination page={page} total={total} q={q} basePath="/app/receipts" />
        </>
      )}
    </div>
  );
}
