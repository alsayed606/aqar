import { createHash, timingSafeEqual } from "node:crypto";

// Secret comparison that does not leak the secret through timing.
//
// `a === b` on strings returns at the first differing byte, so the time it takes reveals how long a
// shared prefix the caller guessed. Against an endpoint that can be called repeatedly — a webhook or
// a cron URL — that is enough to recover the secret one byte at a time.
//
// Hashing both sides first is what makes timingSafeEqual usable here: it demands equal-length
// buffers and throws otherwise, and a length check before it would leak the secret's length. Two
// SHA-256 digests are always 32 bytes, whatever was supplied.
export function secureEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

// `Authorization: Bearer <secret>` as Vercel Cron sends it. A missing secret is a refusal, never a
// pass: an unset CRON_SECRET must not turn the job endpoints into open ones.
export function verifyBearer(header: string | null, secret: string | undefined): boolean {
  const prefix = "Bearer ";
  if (!secret || !header || !header.startsWith(prefix)) return false;
  return secureEquals(header.slice(prefix.length), secret);
}
