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
  const isProtected = pathname === "/app" || pathname.startsWith("/app/") || pathname === "/portal" || pathname.startsWith("/portal/");
  const isLogin = pathname === "/login";

  // Unauthenticated → send to login, remembering where they wanted to go.
  if (isProtected && !user) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("returnTo", pathname + search);
    return withCookies(response, NextResponse.redirect(loginUrl));
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
