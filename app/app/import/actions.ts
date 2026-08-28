"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { HEADERS, IMPORT_KINDS, type ImportKind } from "@/lib/import-headers";
import { refusalAr, type Refusals } from "@/lib/rpc-errors";
import type { FormState } from "@/lib/form-state";

// The limit and the sentence that states it, from one number. They were written twice, and a limit
// that says one thing and enforces another is the kind of lie nobody notices until a file is refused
// for a reason the message denies.
const MAX_FILE_MB = 5;
const MAX_ROWS = 5000;

const IMPORT_REFUSALS: Refusals = [
  [/BATCH_NOT_FOUND/i, "الدفعة غير موجودة"],
  [/ALREADY_COMMITTED/i, "هذه الدفعة معتمدة بالفعل"],
  [/NOT_COMMITTED/i, "لا يمكن التراجع عن دفعة لم تُعتمد"],
  [/HAS_ERRORS|INVALID_ROWS/i, "لا يمكن الاعتماد وفي الدفعة صفوف بها أخطاء"],
];

// Parse the uploaded workbook, stage its rows, and run server-side validation.
export async function startImport(_prev: FormState, formData: FormData): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const kind = String(formData.get("kind") ?? "") as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) return { error: "نوع الاستيراد غير صالح" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "اختر ملف Excel" };
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return { error: `حجم الملف كبير (الحد ${MAX_FILE_MB} ميجابايت)` };
  }

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
  if (rows.length > MAX_ROWS) return { error: `عدد الصفوف كبير (الحد ${MAX_ROWS} صف).` };

  const supabase = await createClient();

  const { data: batch, error: bErr } = await supabase
    .from("import_batch")
    .insert({ org_id: activeOrg, kind, source_filename: file.name })
    .select("id")
    .single();
  if (bErr) return { error: refusalAr(bErr.message, IMPORT_REFUSALS) };

  // The batch has to exist before its rows can point at it, so from here on every failure leaves one
  // behind. An empty, never-validated batch is not harmless: it appears in the office's import list
  // looking like work in progress, and nothing in the product removes it.
  const abandon = async (error: string): Promise<FormState> => {
    const { error: cleanupError } = await supabase.from("import_batch").delete().eq("id", batch.id);
    if (cleanupError) console.error("[import] orphan batch", batch.id, cleanupError.message);
    return { error };
  };

  const headers = HEADERS[kind];
  const staged = rows.map((r, i) => {
    const raw: Record<string, string> = {};
    for (const h of headers) raw[h] = String(r[h] ?? "").trim();
    // +2 because the sheet's first row is the header and spreadsheets count from 1 — the number in
    // an error message has to be the number the office sees in Excel.
    return { batch_id: batch.id, org_id: activeOrg, row_number: i + 2, raw };
  });

  const { error: rErr } = await supabase.from("import_row").insert(staged);
  if (rErr) return abandon(refusalAr(rErr.message, IMPORT_REFUSALS));

  const { error: vErr } = await supabase.rpc("import_validate", { p_batch: batch.id });
  if (vErr) return abandon(refusalAr(vErr.message, IMPORT_REFUSALS));

  redirect(`/app/import/${batch.id}`);
}

// Two buttons on the batch page. Neither has a field, and both change the page they sit on, so they
// answer in a toast and let the batch refresh underneath.
export async function commitImport(_prev: FormState, formData: FormData): Promise<FormState> {
  const batchId = String(formData.get("batch_id") ?? "");
  if (!batchId) return { error: "دفعة غير معروفة" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("import_commit", { p_batch: batchId });
  if (error) return { error: refusalAr(error.message, IMPORT_REFUSALS) };
  revalidatePath(`/app/import/${batchId}`);
  return { ok: "اعتُمد الاستيراد." };
}

/**
 * Undo a committed import.
 *
 * The reason is written by the office, not by us. It used to be the constant "user_revert", which
 * made every undo in the audit log identical — and an audit line that says the same thing every time
 * answers no question anyone will ever ask of it. Reverting an import deletes real rows; whoever
 * looks back deserves to know which import went wrong and why.
 */
export async function revertImport(_prev: FormState, formData: FormData): Promise<FormState> {
  const batchId = String(formData.get("batch_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!batchId) return { error: "دفعة غير معروفة" };
  if (!reason) return { error: "اكتب سبب التراجع", field: "reason", values: { reason } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("import_revert", { p_batch: batchId, p_reason: reason });
  if (error) return { error: refusalAr(error.message, IMPORT_REFUSALS), values: { reason } };
  revalidatePath(`/app/import/${batchId}`);
  return { ok: "تُرجِع الاستيراد." };
}
