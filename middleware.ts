import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/return-to";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Copy any auth cookies the session-refresh wrote onto a redirect response so the refreshed
// tokens aren't dropped when we bounce the request.
function withCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

/**
 * Refreshes the Supabase auth session on every request and keeps auth cookies in sync
 * (the standard @supabase/ssr middleware pattern), and guards the app + portal surfaces:
 * an unauthenticated deep link is sent to /login?returnTo=… so login lands the user back where
 * they were headed (crucial for invite/portal links), and an already-signed-in user hitting
 * /login is forwarded on to their intended destination.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Nothing to refresh until env is configured; let the request through.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touch the session so an expired access token is refreshed and re-set on the response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search, origin } = request.nextUrl;
  // Next.js runs exactly one middleware, so each surface is a branch here rather than a file of its
  // own. This only decides "signed in or not"; whether the caller may see the platform console is
  // decided by the database, in app/platform/layout.tsx and again inside every platform RPC.
  const isProtected =
    pathname === "/app" || pathname.startsWith("/app/") ||
    pathname === "/portal" || pathname.startsWith("/portal/") ||
    pathname === "/platform" || pathname.startsWith("/platform/");
  const isLogin = pathname === "/login";

  // Unauthenticated → send to login, remembering where they wanted to go.
  if (isProtected && !user) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("returnTo", pathname + search);
    return withCookies(response, NextResponse.redirect(loginUrl));
  }

  // Signed in, has a second factor, but has not used it in this session → step up before anything.
  // Enforced here rather than per page so a route added later is covered by default; forgetting the
  // check is the normal way this protection ends up missing from exactly one screen.
  if (isProtected && user && pathname !== "/auth/mfa") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    let stepUp = aal?.nextLevel === "aal2" && aal.currentLevel === "aal1";

    // The e-mail factor (migration 0069) is ours, so Supabase's assurance level knows nothing about
    // it and the database has to be asked. Only when TOTP has not already sent us to the same place:
    // one redirect is one redirect, and the extra round trip buys nothing.
    if (!stepUp) {
      const { data: mfa } = await supabase.schema("app").rpc("mfa_state");
      const row = Array.isArray(mfa) ? mfa[0] : mfa;
      stepUp = row?.enabled === true && row?.stepped_up !== true;
    }

    if (stepUp) {
      const mfaUrl = new URL("/auth/mfa", origin);
      mfaUrl.searchParams.set("returnTo", pathname + search);
      return withCookies(response, NextResponse.redirect(mfaUrl));
    }
  }

  // Already signed in but sitting on /login → forward to the intended (validated) destination.
  if (isLogin && user) {
    const dest = safeReturnTo(request.nextUrl.searchParams.get("returnTo")) ?? "/app";
    const destUrl = new URL(dest, origin);
    if (destUrl.origin !== origin) destUrl.href = new URL("/app", origin).href;
    return withCookies(response, NextResponse.redirect(destUrl));
  }

  return response;
}

export const config = {
  // Run on everything except static assets and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
