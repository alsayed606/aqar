const AR = "٠١٢٣٤٥٦٧٨٩";
const FA = "۰۱۲۳۴۵۶۷۸۹";

/** Fold Arabic-Indic / Persian digits to ASCII. */
export function foldDigits(input: string): string {
  return (input ?? "").replace(/[٠-٩۰-۹]/g, (d) => {
    const a = AR.indexOf(d);
    if (a >= 0) return String(a);
    const f = FA.indexOf(d);
    return f >= 0 ? String(f) : d;
  });
}

/** Parse a possibly-Arabic number string to a finite number, or null. */
export function parseArabicNumber(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = foldDigits(String(input)).replace(/[^0-9.\-]/g, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse to a non-negative integer, or null. */
export function parseArabicInt(input: string | null | undefined): number | null {
  const n = parseArabicNumber(input);
  return n == null ? null : Math.trunc(n);
}
