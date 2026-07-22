import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";

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

const DOC_KIND_AR: Record<string, string> = {
  invoice: "فاتورة",
  credit_note: "إشعار دائن",
  debit_note: "إشعار مدين",
};

export default async function InvoicesPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data } = await supabase
    .from("invoice")
    .select("id, invoice_no, invoice_type, doc_kind, issue_at, buyer_name, total_incl_vat_halalas, total_vat_halalas, status")
    .is("deleted_at", null)
    .order("issue_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as InvoiceRow[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الفواتير</h1>
        <span className="text-sm text-neutral-500">{rows.length} فاتورة</span>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        تُصدَر الفاتورة من صفحة العقد لكل استحقاق. الفاتورة توثّق التوريد وضريبته — مستقلّة عن السداد (يُثبت السداد بسند القبض).
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد فواتير بعد. افتح عقداً فعّالاً وأصدر فاتورة لأحد الاستحقاقات.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 text-right font-medium">رقم الفاتورة</th>
                <th className="px-4 py-2 text-right font-medium">التاريخ</th>
                <th className="px-4 py-2 text-right font-medium">المشتري</th>
                <th className="px-4 py-2 text-right font-medium">النوع</th>
                <th className="px-4 py-2 text-right font-medium">الحالة</th>
                <th className="px-4 py-2 text-right font-medium">الضريبة (ر.س)</th>
                <th className="px-4 py-2 text-right font-medium">الإجمالي (ر.س)</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono font-medium" dir="ltr">{r.invoice_no ?? "—"}</td>
                  <td className="px-4 py-2" dir="ltr">{new Date(r.issue_at).toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2">{r.buyer_name ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-neutral-500">
                    {DOC_KIND_AR[r.doc_kind] ?? "فاتورة"}
                    {r.doc_kind === "invoice" && (r.invoice_type === "plain" ? " عادية" : " ضريبية")}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.status === "cancelled" ? (
                      <span className="text-red-600 dark:text-red-400">ملغاة</span>
                    ) : (
                      <span className="text-neutral-500">سارية</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{halalasToSar(r.total_vat_halalas)}</td>
                  <td className="px-4 py-2 font-medium">{halalasToSar(r.total_incl_vat_halalas)}</td>
                  <td className="px-4 py-2">
                    <Link href={`/app/invoices/${r.id}`} className="text-brand hover:underline">
                      عرض / طباعة ←
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
