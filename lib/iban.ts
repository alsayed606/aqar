/**
 * IBAN check digits (ISO 7064, mod-97-10).
 *
 * A shape check — "SA followed by 22 digits" — passes a transposed pair, and a transposed pair in a
 * collection account is money arriving somewhere else. This is the arithmetic the banks use to catch
 * exactly that, and it is the one thing about an IBAN a database CHECK cannot express.
 *
 * Kept import-free so it can be exercised directly by the test runner.
 */
export function isValidIban(input: string): boolean {
  const iban = input.toUpperCase().replace(/\s+/g, "");
  // 15 (Norway) to 34 (the ISO ceiling) characters, letters and digits after the country code.
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$/.test(iban)) return false;

  // The country code and check digits move to the end, letters become numbers (A = 10 … Z = 35),
  // and the whole thing read as one integer must leave a remainder of 1. It is carried digit by
  // digit because the integer is far past what a JS number holds exactly.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const digits =
      character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
