import { parseArabicNumber } from "./num";

/** Integer halalas → a grouped SAR string (e.g. 12000000 → "120,000.00"). */
export function halalasToSar(h: number | string | null | undefined): string {
  if (h == null || h === "") return "—";
  const n = Number(h) / 100;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** SAR string (possibly Arabic digits) → integer halalas, or null. */
export function sarToHalalas(input: string | null | undefined): number | null {
  const n = parseArabicNumber(input ?? "");
  return n == null ? null : Math.round(n * 100);
}
