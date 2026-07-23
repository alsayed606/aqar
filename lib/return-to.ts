// Validate a post-login "return to" path. The value is attacker-influenceable (it rides in the
// /login?returnTo=… query), so it must be constrained to an app-internal absolute path — never a
// full URL or protocol-relative URL that could drive an open redirect off-site.
//
// Rejected: null/empty · anything not starting with a single "/" · protocol-relative "//host" ·
// the backslash trick "/\host" (browsers normalise "\" to "/") · control/whitespace chars ·
// over-long values · the login route itself (avoids a pointless bounce back to /login).
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 1024) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw.startsWith("/login")) return null;
  // Reject any control char, space (32) or DEL (127) — blocks CRLF/whitespace smuggling.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 32 || code === 127) return null;
  }
  return raw;
}
