import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { halalasToSar } from "@/lib/money";
import { PAYMENT_METHOD_AR } from "@/lib/labels";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const first = (x: any) => (Array.isArray(x) ? x[0] : x);

type PaymentRow = {
  id: string;
  receipt_no: string | null;
  amount_halalas: number;
  method: string;
  received_at: string;
  party: any;
};

export default async function ReceiptsPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data } = await supabase
    .from("payment")
    .select("id, receipt_no, amount_halalas, method, received_at, party:party_id(display_name)")
    .is("deleted_at", null)
    .order("received_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as PaymentRow[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">سندات القبض</h1>
        <span className="text-sm text-neutral-500">{rows.length} سند</span>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        لكل دفعة مستلمة سند قبض مرقّم — إثبات للتحصيل (نقداً أو تحويلاً). سجّل الدفعات من صفحة العقد، وتظهر هنا.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد دفعات مسجّلة بعد. سجّل دفعة من صفحة العقد لإصدار أول سند قبض.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 text-right font-medium">رقم السند</th>
                <th className="px-4 py-2 text-right font-medium">التاريخ</th>
                <th className="px-4 py-2 text-right font-medium">المستلم منه</th>
                <th className="px-4 py-2 text-right font-medium">المبلغ (ر.س)</th>
                <th className="px-4 py-2 text-right font-medium">الطريقة</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-mono font-medium" dir="ltr">{p.receipt_no ?? "—"}</td>
                  <td className="px-4 py-2" dir="ltr">{new Date(p.received_at).toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2">{first(p.party)?.display_name ?? "—"}</td>
                  <td className="px-4 py-2 font-medium">{halalasToSar(p.amount_halalas)}</td>
                  <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{PAYMENT_METHOD_AR[p.method] ?? p.method}</td>
                  <td className="px-4 py-2">
                    <Link href={`/app/receipts/${p.id}`} className="text-brand hover:underline">
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
