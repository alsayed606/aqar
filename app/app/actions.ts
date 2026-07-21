"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  if (error) return { error: error.message };

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
