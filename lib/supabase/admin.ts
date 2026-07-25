import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS. Use ONLY in the notification drainer
 * (app/api/cron/drain-notifications) and only for the minimum it needs: claiming email deliveries
 * and marking their status. The rest of the app must keep using the session-bound client + RLS.
 *
 * No cookies, no session persistence: this is a headless, server-only credential.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("admin client not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(url, key, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
