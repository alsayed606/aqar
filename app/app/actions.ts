"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type OrgState = { error?: string };

const ACTIVE_ORG_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

// Create the user's organization (office). The RPC also creates the owner membership and the
// auto self-Owner (see SCHEMA.md §2). We then set the active-org context cookie and enter the app.
export async function createOrg(
  _prev: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "اسم المنشأة مطلوب" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: name,
  });
  if (error) {
    if (/OWN_ORG_EXISTS/i.test(error.message)) return { error: "لا يمكنك إنشاء أكثر من منشأة واحدة. يمكنك الانضمام لمنشآت أخرى عبر دعوة." };
    return { error: error.message };
  }

  (await cookies()).set("active-org", String(data), ACTIVE_ORG_COOKIE);
  redirect("/app");
}

// Switch the active organization (the value RLS proves against on every query).
export async function switchOrg(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  if (orgId) {
    (await cookies()).set("active-org", orgId, ACTIVE_ORG_COOKIE);
  }
  redirect("/app");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete("active-org");
  redirect("/login");
}

// Internal notes on a persistent entity (§6.1, migration 0065). One action for tenant, owner and
// property — the design system is explicit that this is implemented once and reused, never per
// module. The author and the timestamp come from the database, so nothing here is trusted from the
// form beyond the text itself.
export type NoteState = { error?: string; ok?: boolean };

const NOTE_TARGETS = { tenant: "tenant_id", owner: "owner_id", property: "property_id" } as const;
export type NoteTarget = keyof typeof NOTE_TARGETS;

export async function addEntityNote(
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const activeOrg = (await cookies()).get("active-org")?.value;
  if (!activeOrg) return { error: "اختر منشأة نشطة أولاً" };

  const target = String(formData.get("target") ?? "") as NoteTarget;
  const entityId = String(formData.get("entity_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!(target in NOTE_TARGETS)) return { error: "نوع السجل غير معروف" };
  if (!entityId) return { error: "السجل غير محدّد" };
  if (!body) return { error: "اكتب نص الملاحظة" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("entity_note")
    .insert({ org_id: activeOrg, [NOTE_TARGETS[target]]: entityId, body });
  if (error) return { error: error.message };

  // The note appears on the entity's own page; nothing else displays it.
  revalidatePath(`/app/${target === "property" ? "properties" : target === "owner" ? "owners" : "tenants"}/${entityId}`);
  return { ok: true };
}
