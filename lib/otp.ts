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

// ---------------------------------------------------------------------------
// Recovery codes (migration 0070) — the sheet the user keeps for the day the phone is gone.
// ---------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_CHARS = 10;

/**
 * Crockford's base32: the digits and letters minus I, L, O and U.
 *
 * I/1, L/1 and O/0 are the pairs people mistype off a piece of paper, and a recovery code is read
 * off paper by definition — a wrong character here costs the user their only way back in. U is
 * dropped with them so the alphabet lands on exactly 32 symbols, which makes each character worth a
 * whole five bits.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * One recovery code: ten symbols, fifty bits, printed as two groups of five.
 *
 * Fifty bits is the number that lets `mfa_recovery_consume` answer honestly without a slow hash —
 * ten wrong guesses per fifteen minutes against 2^50 is not an attack, it is a rounding error.
 * `randomInt` and not `Math.random()` for the reason `generateOtpCode` gives.
 */
export function generateRecoveryCode(): string {
  let out = "";
  for (let i = 0; i < RECOVERY_CODE_CHARS; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  // A duplicate inside one sheet would be a sheet with nine codes on it, and the database rejects
  // the whole set rather than silently issuing fewer than promised.
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/**
 * Accepts what a human actually types: lower case, missing dash, extra spaces, and the three
 * look-alike characters folded onto the symbols they were dropped in favour of.
 */
export function normalizeRecoveryCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

/**
 * Hashes a recovery code for storage, salted with the account id exactly as `hashOtpCode` is —
 * and with a distinct prefix, so a value stored as a recovery code can never be replayed as a
 * six-digit challenge or the other way round.
 */
export function hashRecoveryCode(code: string, accountId: string): string {
  return createHash("sha256").update(`${accountId}:rc:${normalizeRecoveryCode(code)}`).digest("hex");
}

/** Digits only, so a pasted "123 456" or an Arabic-Indic paste still verifies. */
export function normalizeOtpInput(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
}
