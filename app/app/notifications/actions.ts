"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";

// Explicit refresh. The Cron sweep (0059) is what keeps notifications current; this exists so an
// office that just recorded a payment does not have to wait for the next run to see the effect.
export async function refreshNotifications() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const supabase = await createClient();
  await supabase.rpc("generate_notifications", { p_org: activeOrg });
  await supabase.rpc("enqueue_email_deliveries", { p_org: activeOrg });
  revalidatePath("/app/notifications");
  redirect("/app/notifications");
}

export async function markAllRead() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_org: activeOrg, p_ids: null });
  revalidatePath("/app/notifications");
  redirect("/app/notifications");
}
