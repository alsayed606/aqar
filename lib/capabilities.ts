import { createClient } from "@/lib/supabase/server";

export type Capability = "view" | "manage_data" | "manage_finance" | "manage_team" | "manage_billing";

// The caller's capability set for the active org (from current_capabilities, migration 0041).
// Tolerant: returns an empty set on any error (e.g. before 0041) — RLS is the real gate; the UI just
// hides controls a role can't use.
export async function getCapabilities(activeOrg: string): Promise<Set<Capability>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_capabilities", { p_org: activeOrg });
  return new Set(((data ?? []) as Capability[]));
}
