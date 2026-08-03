import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Throttling for the auth surface. State lives in Postgres (migration 0060) because Vercel's
// serverless instances share nothing — an in-memory counter would reset per invocation.

export type RateLimitVerdict = { allowed: boolean; retryAfter: number };

// The identifying part of a bucket is hashed before it leaves this file: the counter table must not
// accumulate raw e-mail addresses or phone numbers, and a fixed-width key keeps attacker-supplied
// input from growing rows without bound.
function bucketKey(scope: string, identifier: string): string {
  return `${scope}:${createHash("sha256").update(identifier.toLowerCase()).digest("hex").slice(0, 32)}`;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  // Vercel always sets x-forwarded-for; the client's address is the first entry.
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Counts one attempt against `scope:identifier` and reports whether it may proceed.
 *
 * **Fails open, deliberately.** If the service key is unset or the database is unreachable this
 * returns `allowed`, and logs. The limiter is a second line of defence over Supabase Auth's own
 * throttling, so a database blip should degrade protection — not lock every customer out of their
 * account. The log line is what makes the degradation visible rather than silent.
 */
export async function rateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    console.error(`[rate-limit] no service key configured; ${scope} is unthrottled`);
    return { allowed: true, retryAfter: 0 };
  }

  const { data, error } = await admin.rpc("rate_limit_hit", {
    p_bucket: bucketKey(scope, identifier),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error(`[rate-limit] ${scope} check failed, allowing through: ${error.message}`);
    return { allowed: true, retryAfter: 0 };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed: boolean; retry_after: number }
    | undefined;
  if (!row) return { allowed: true, retryAfter: 0 };
  return { allowed: row.allowed, retryAfter: Number(row.retry_after) || 0 };
}

// Arabic refusal, rounded up to whole minutes because a countdown in seconds invites retrying.
export function throttledMessage(retryAfter: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return `محاولات كثيرة. حاول بعد ${minutes} دقيقة.`;
}

/**
 * Guards an action against two buckets at once: the caller's address and the account they are
 * aiming at. The pair matters — an IP-only limit lets a botnet spread a password-spray attack
 * across thousands of addresses, while an account-only limit lets one address work through a list
 * of accounts. Returns the refusal message, or null to proceed.
 */
export async function guardAuthAttempt(
  scope: string,
  target: string,
  limits: { perIp: [number, number]; perTarget: [number, number] },
): Promise<string | null> {
  const ip = await rateLimit(`${scope}:ip`, await clientIp(), ...limits.perIp);
  if (!ip.allowed) return throttledMessage(ip.retryAfter);

  const account = await rateLimit(`${scope}:target`, target, ...limits.perTarget);
  if (!account.allowed) return throttledMessage(account.retryAfter);

  return null;
}
