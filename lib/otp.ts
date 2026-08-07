import { createHash, randomInt } from "node:crypto";

// The six digits themselves, and the one-way form the database is allowed to see.
//
// Codes are generated HERE, not in Postgres, so no live code ever exists inside the database — a
// dump or a stray SELECT yields hashes only. This is the same discipline the (now dropped) 0004
// phone-OTP tables were written with.

export const OTP_LENGTH = 6;
/** Ten minutes. Long enough for a mail server to be slow, short enough that a forwarded code is stale. */
export const OTP_TTL_SECONDS = 600;

/**
 * A uniformly random six-digit code, leading zeros kept.
 *
 * `randomInt` and not `Math.random()`: this value is a credential, and `Math.random()` is a
 * predictable PRNG whose next output can be recovered from earlier ones.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, "0");
}

/**
 * Hashes a code for storage and comparison.
 *
 * Salted with the account id so the same six digits hash differently for two people — without it a
 * single precomputed table of a million digests would read every stored code at once. It is a fast
 * hash on purpose: the code lives ten minutes and survives five wrong guesses, so the attempt
 * counter, not the hash cost, is what bounds an attacker.
 */
export function hashOtpCode(code: string, accountId: string): string {
  return createHash("sha256").update(`${accountId}:${code}`).digest("hex");
}

/** Digits only, so a pasted "123 456" or an Arabic-Indic paste still verifies. */
export function normalizeOtpInput(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
}
