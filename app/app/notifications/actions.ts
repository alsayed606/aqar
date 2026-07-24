"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";

export async function markAllRead() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_org: activeOrg, p_ids: null });
  revalidatePath("/app/notifications");
  redirect("/app/notifications");
}
