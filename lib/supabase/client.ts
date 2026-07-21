import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (Client Components). Used mainly for auth UI state; data reads/writes go
 * through the server client so the x-active-org context stays server-controlled. Defaults to the
 * `app` schema to match the server client.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "app" } },
  );
}
