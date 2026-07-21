import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { ImportForm } from "@/components/import-form";
import {
  IMPORT_KINDS,
  KIND_LABEL,
  KIND_TEMPLATE,
  IMPORT_ORDER_HINT,
} from "@/lib/import-headers";

export const dynamic = "force-dynamic";

const STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  validated: "تم التحقق",
  committed: "معتمد",
  reverted: "متراجع عنه",
  failed: "فشل",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ImportPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data: batches } = await supabase
    .from("import_batch")
    .select("id, kind, status, total_rows, valid_rows, error_rows, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">استيراد من Excel</h1>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 text-base font-semibold">١) نزّل القالب المناسب</h2>
        <p className="mb-3 text-sm text-neutral-500">{IMPORT_ORDER_HINT}</p>
        <div className="flex flex-wrap gap-2">
          {IMPORT_KINDS.map((k) => (
            <a
              key={k}
              href={KIND_TEMPLATE[k]}
              download
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              ⬇ قالب {KIND_LABEL[k]}
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-base font-semibold">٢) ارفع الملف بعد تعبئته</h2>
        <p className="mb-4 text-sm text-neutral-500">
          سنتحقّق من كل صف ونعرض لك النتيجة قبل الاعتماد. لن يُحفظ شيء إلا بعد ضغطك «اعتماد».
        </p>
        <ImportForm />
      </section>

      {batches && batches.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">دفعات الاستيراد الأخيرة</h2>
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2 text-right font-medium">النوع</th>
                  <th className="px-4 py-2 text-right font-medium">الحالة</th>
                  <th className="px-4 py-2 text-right font-medium">صحيحة / أخطاء / الإجمالي</th>
                  <th className="px-4 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {batches.map((b: any) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2">{KIND_LABEL[b.kind as keyof typeof KIND_LABEL] ?? b.kind}</td>
                    <td className="px-4 py-2">{STATUS_AR[b.status] ?? b.status}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">
                      {b.valid_rows} / {b.error_rows} / {b.total_rows}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/app/import/${b.id}`} className="text-brand underline">
                        عرض
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
