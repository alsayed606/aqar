import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server-side Supabase client (Server Components, Route Handlers, Server Actions).
 *
 * Two deliberate choices from the data-layer design:
 *   1. db.schema = 'app'      → all .from() calls target our app schema (not public).
 *   2. x-active-org header    → the ACTIVE ORG is passed as request context, never baked into the
 *      JWT. RLS re-proves membership against this header on every query (see SCHEMA.md §6). The
 *      value is read from the `active-org` cookie set when the user picks/switches an organization.
 *
 * Data access is kept server-side so the org header is set server-controlled and there is no
 * browser CORS surface for the custom header.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const activeOrg = cookieStore.get("active-org")?.value ?? "";

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "app" },
      global: {
        headers: activeOrg ? { "x-active-org": activeOrg } : {},
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — cookie writes are ignored here and are
            // refreshed by the middleware instead. This is the documented @supabase/ssr pattern.
          }
        },
      },
    },
  );
}
