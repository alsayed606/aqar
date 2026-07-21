// supabase/functions/import-excel/index.ts
// Excel import Edge Function (Deno). Thin transport layer over the SQL import pipeline in
// migration 0016. It parses the workbook and stages rows; ALL normalization, validation,
// reference resolution, commit, and revert happen in Postgres so they are covered by the tests
// and share the exact same normalization functions used everywhere else. SCHEMA.md §11.
//
// Actions:
//   POST { action: "preview",  kind, filename, rowsBase64 }  -> creates batch, stages rows,
//                                                               runs import_validate, returns
//                                                               per-row errors + counts (nothing committed)
//   POST { action: "commit",  batchId }                      -> import_commit (only valid rows)
//   POST { action: "revert",  batchId }                      -> import_revert (soft-delete whole batch)
//
// Security: the caller's JWT + the x-active-org header flow straight through to Postgres, so RLS
// applies. The function never elevates to service_role for import writes.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const KINDS = ["properties", "units", "owners", "tenants", "contracts", "charges"] as const;
type Kind = (typeof KINDS)[number];

// Canonical Arabic headers per sheet — must match the templates and migration 0016.
const HEADERS: Record<Kind, string[]> = {
  properties: ["اسم العقار", "نوع العقار", "رقم الصك", "المدينة", "الحي", "العنوان", "اسم المالك"],
  units:      ["اسم العقار", "رقم الوحدة", "الدور", "المساحة", "غرف النوم", "دورات المياه", "الحالة"],
  owners:     ["الاسم", "النوع", "رقم الهوية", "الجوال", "الآيبان", "البنك"],
  tenants:    ["الاسم", "النوع", "رقم الهوية", "الجوال", "البريد الإلكتروني"],
  contracts:  ["رقم العقد", "اسم العقار", "رقم الوحدة", "اسم المستأجر", "رقم هوية المستأجر",
               "تاريخ البداية", "تاريخ النهاية", "الإيجار السنوي", "دورية الدفع", "التأمين",
               "رسوم الخدمات", "رقم عقد إيجار", "رقم الصك"],
  charges:    ["رقم العقد", "نوع الاستحقاق", "تاريخ الاستحقاق", "المبلغ قبل الضريبة", "نسبة الضريبة", "الوصف"],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const activeOrg = req.headers.get("x-active-org") ?? "";
  if (!authHeader) return json({ error: "auth_required" }, 401);
  if (!activeOrg) return json({ error: "active_org_required" }, 400);

  // Forward the caller's JWT + active-org so Postgres RLS applies to every statement.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader, "x-active-org": activeOrg } } },
  );

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = payload?.action;

  try {
    if (action === "commit") {
      if (!payload.batchId) return json({ error: "batchId_required" }, 400);
      const { error } = await supabase.schema("app").rpc("import_commit", { p_batch: payload.batchId });
      if (error) throw error;
      return json({ ok: true, batchId: payload.batchId, status: "committed" });
    }

    if (action === "revert") {
      if (!payload.batchId) return json({ error: "batchId_required" }, 400);
      const { error } = await supabase.schema("app").rpc("import_revert", {
        p_batch: payload.batchId, p_reason: payload.reason ?? "import_revert",
      });
      if (error) throw error;
      return json({ ok: true, batchId: payload.batchId, status: "reverted" });
    }

    if (action === "preview") {
      const kind = payload.kind as Kind;
      if (!KINDS.includes(kind)) return json({ error: "invalid_kind", allowed: KINDS }, 400);
      if (!payload.rowsBase64) return json({ error: "rowsBase64_required" }, 400);

      // Parse the first sheet into objects keyed by the Arabic headers.
      const bytes = Uint8Array.from(atob(payload.rowsBase64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(bytes, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
      if (rows.length === 0) return json({ error: "empty_sheet" }, 400);

      // Create the batch (org_id defaulted by RLS context is NOT automatic — set explicitly).
      const { data: batch, error: bErr } = await supabase
        .schema("app").from("import_batch")
        .insert({ org_id: activeOrg, kind, source_filename: payload.filename ?? null })
        .select("id").single();
      if (bErr) throw bErr;

      // Stage rows: keep only known headers; row_number is 1-based (matches the sheet, header = row 1).
      const staged = rows.map((r, i) => {
        const raw: Record<string, string> = {};
        for (const h of HEADERS[kind]) raw[h] = (r[h] ?? "").toString();
        return { batch_id: batch.id, org_id: activeOrg, row_number: i + 2, raw };
      });
      const { error: rErr } = await supabase.schema("app").from("import_row").insert(staged);
      if (rErr) throw rErr;

      // Validate in Postgres (normalization + reference resolution + per-field errors).
      const { error: vErr } = await supabase.schema("app").rpc("import_validate", { p_batch: batch.id });
      if (vErr) throw vErr;

      // Return the preview: counts + the rows that failed, with reasons.
      const { data: batchRow } = await supabase.schema("app").from("import_batch")
        .select("total_rows, valid_rows, error_rows, status").eq("id", batch.id).single();
      const { data: errorRows } = await supabase.schema("app").from("import_row")
        .select("row_number, errors").eq("batch_id", batch.id).eq("is_valid", false).order("row_number");

      return json({ ok: true, batchId: batch.id, summary: batchRow, errorRows });
    }

    return json({ error: "unknown_action", allowed: ["preview", "commit", "revert"] }, 400);
  } catch (e) {
    return json({ error: "import_failed", detail: String((e as any)?.message ?? e) }, 400);
  }
});
