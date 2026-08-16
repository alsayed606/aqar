"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { sarToHalalas } from "@/lib/money";
import { WRITE_REFUSED_AR, writeRefused } from "@/lib/rpc-errors";
import type { FormState } from "@/lib/form-state";

// The office's side of a maintenance request (0072).
//
// Both actions write through RLS as the signed-in member, so a member confined to certain properties
// simply matches no row — which is why each one checks the row count rather than the error alone.

const STATUSES = ["open", "in_progress", "resolved", "cancelled"];
const BEARERS = ["owner", "tenant", "office"];

/** Move a request along its lifecycle. resolved_at is stamped by the database, not from here. */
export async function setMaintenanceStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("request_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.includes(status)) return { error: "حالة غير صالحة" };

  const note = String(formData.get("resolution_note") ?? "").trim();
  // Closing without saying how is how a request becomes unanswerable three months later.
  if (status === "resolved" && !note) {
    return { error: "اكتب كيف عولج الطلب قبل إغلاقه.", field: "resolution_note", values: { resolution_note: note } };
  }

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("maintenance_request")
    .update({
      status,
      resolution_note: status === "resolved" ? note : null,
      cancelled_reason: status === "cancelled" ? note || null : null,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (writeRefused(data)) return { error: WRITE_REFUSED_AR };

  revalidatePath("/app/maintenance");
  return { ok: "حُدِّثت حالة الطلب." };
}

/** Who is doing the work, what it is expected to cost, and who carries that cost. */
export async function saveMaintenanceAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  const id = String(formData.get("request_id") ?? "");
  if (!activeOrg || !id) return { error: "طلب غير معروف" };

  const assignee = String(formData.get("assignee_name") ?? "").trim();
  const vendor = String(formData.get("vendor_name") ?? "").trim();
  const costText = String(formData.get("estimated_cost") ?? "").trim();
  const bearer = String(formData.get("cost_bearer") ?? "").trim();
  const values = { assignee_name: assignee, vendor_name: vendor, estimated_cost: costText, cost_bearer: bearer };

  const estimated = costText ? sarToHalalas(costText) : null;
  if (costText && (estimated == null || estimated < 0)) {
    return { error: "أدخل تكلفة صحيحة", field: "estimated_cost", values };
  }
  if (bearer && !BEARERS.includes(bearer)) return { error: "اختر من يتحمّل التكلفة", field: "cost_bearer", values };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("maintenance_request")
    .update({
      assignee_name: assignee || null,
      vendor_name: vendor || null,
      estimated_cost_halalas: estimated,
      cost_bearer: bearer || null,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message, values };
  if (writeRefused(data)) return { error: WRITE_REFUSED_AR, values };

  revalidatePath("/app/maintenance");
  return { ok: "حُفظ التعيين." };
}
