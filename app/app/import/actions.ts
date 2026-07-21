"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { HEADERS, IMPORT_KINDS, type ImportKind } from "@/lib/import-headers";

export type ImportState = { error?: string };

// Parse the uploaded workbook, stage its rows, and run server-side validation.
export async function startImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const kind = String(formData.get("kind") ?? "") as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) return { error: "نوع الاستيراد غير صالح" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "اختر ملف Excel" };
  if (file.size > 5 * 1024 * 1024) return { error: "حجم الملف كبير (الحد 5 ميجابايت)" };

  let rows: Record<string, unknown>[];
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  } catch {
    return { error: "تعذّر قراءة الملف. تأكد أنه ملف Excel صالح (.xlsx)." };
  }
  if (rows.length === 0) return { error: "الملف لا يحتوي على صفوف بيانات." };
  if (rows.length > 5000) return { error: "عدد الصفوف كبير (الحد 5000 صف)." };

  const supabase = await createClient();

  const { data: batch, error: bErr } = await supabase
    .from("import_batch")
    .insert({ org_id: activeOrg, kind, source_filename: file.name })
    .select("id")
    .single();
  if (bErr) return { error: bErr.message };

  const headers = HEADERS[kind];
  const staged = rows.map((r, i) => {
    const raw: Record<string, string> = {};
    for (const h of headers) raw[h] = String(r[h] ?? "").trim();
    return { batch_id: batch.id, org_id: activeOrg, row_number: i + 2, raw };
  });

  const { error: rErr } = await supabase.from("import_row").insert(staged);
  if (rErr) return { error: rErr.message };

  const { error: vErr } = await supabase.rpc("import_validate", { p_batch: batch.id });
  if (vErr) return { error: vErr.message };

  redirect(`/app/import/${batch.id}`);
}

export async function commitImport(formData: FormData) {
  const batchId = String(formData.get("batch_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("import_commit", { p_batch: batchId });
  if (error) redirect(`/app/import/${batchId}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/app/import/${batchId}`);
  redirect(`/app/import/${batchId}`);
}

export async function revertImport(formData: FormData) {
  const batchId = String(formData.get("batch_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("import_revert", {
    p_batch: batchId,
    p_reason: "user_revert",
  });
  if (error) redirect(`/app/import/${batchId}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/app/import/${batchId}`);
  redirect(`/app/import/${batchId}`);
}
