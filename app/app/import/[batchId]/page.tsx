import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { commitImport, revertImport } from "../actions";
import { KIND_LABEL } from "@/lib/import-headers";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
type ErrRow = { row_number: number; errors: Array<{ field: string; value: string; reason: string }> };

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { batchId } = await params;
  const { error: flashError } = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("import_batch")
    .select("id, kind, status, total_rows, valid_rows, error_rows, source_filename")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) notFound();

  const { data: errData } = await supabase
    .from("import_row")
    .select("row_number, errors")
    .eq("batch_id", batchId)
    .eq("is_valid", false)
    .order("row_number", { ascending: true })
    .limit(200);
  const errorRows = (errData ?? []) as ErrRow[];

  const canCommit = batch.status === "validated" && batch.valid_rows > 0;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/import" className="hover:text-brand">
          استيراد
        </Link>{" "}
        / <span className="text-neutral-700 dark:text-neutral-300">معاينة الدفعة</span>
      </nav>

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

      <header className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-1 text-lg font-semibold">
          استيراد {KIND_LABEL[batch.kind as keyof typeof KIND_LABEL] ?? batch.kind}
        </h1>
        {batch.source_filename && (
          <p className="mb-4 text-sm text-neutral-500" dir="ltr">
            {batch.source_filename}
          </p>
        )}
        <div className="flex flex-wrap gap-6 text-sm">
          <span>الإجمالي: <b>{batch.total_rows}</b></span>
          <span className="text-emerald-700 dark:text-emerald-400">صحيحة: <b>{batch.valid_rows}</b></span>
          <span className="text-red-700 dark:text-red-400">أخطاء: <b>{batch.error_rows}</b></span>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          {batch.status === "committed" ? (
            <>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                ✓ تم الاعتماد ({batch.valid_rows} سجل)
              </span>
              <form action={revertImport}>
                <input type="hidden" name="batch_id" value={batch.id} />
                <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20">
                  التراجع عن الدفعة
                </button>
              </form>
            </>
          ) : batch.status === "reverted" ? (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              تم التراجع عن هذه الدفعة (حُذفت سجلاتها)
            </span>
          ) : canCommit ? (
            <form action={commitImport}>
              <input type="hidden" name="batch_id" value={batch.id} />
              <button className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg">
                اعتماد الصفوف الصحيحة ({batch.valid_rows})
              </button>
            </form>
          ) : (
            <span className="text-sm text-neutral-500">
              لا توجد صفوف صحيحة للاعتماد. صحّح الأخطاء أدناه ثم أعد الرفع.
            </span>
          )}
          {batch.error_rows > 0 && batch.status === "validated" && (
            <span className="self-center text-xs text-neutral-500">
              سيتم اعتماد الصفوف الصحيحة فقط؛ صفوف الأخطاء تُتجاهل.
            </span>
          )}
        </div>
      </header>

      {errorRows.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">تقرير الأخطاء</h2>
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2 text-right font-medium">الصف</th>
                  <th className="px-4 py-2 text-right font-medium">الحقل</th>
                  <th className="px-4 py-2 text-right font-medium">القيمة</th>
                  <th className="px-4 py-2 text-right font-medium">السبب</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {errorRows.flatMap((r) =>
                  (r.errors ?? []).map((e, idx) => (
                    <tr key={`${r.row_number}-${idx}`}>
                      <td className="px-4 py-2 font-medium">{r.row_number}</td>
                      <td className="px-4 py-2">{e.field}</td>
                      <td className="px-4 py-2 text-neutral-500" dir="ltr">{e.value || "—"}</td>
                      <td className="px-4 py-2 text-red-700 dark:text-red-400">{e.reason}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
