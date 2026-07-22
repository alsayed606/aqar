// ZATCA e-invoicing QR payload (Phase 1 / Generation).
// The simplified tax-invoice QR carries 5 mandatory fields, each TLV-encoded (Tag, Length, Value)
// with UTF-8 values, then Base64-encoded:
//   1 seller name · 2 seller VAT number · 3 timestamp (ISO 8601) · 4 invoice total (incl VAT) · 5 VAT total
// Phase 2 adds tags 6–9 (XML hash, ECDSA signature, public key, stamp) — out of scope here.

function tlv(tag: number, value: string): Buffer {
  const val = Buffer.from(value, "utf8");
  // ZATCA fields are short; a single length byte (value < 256 bytes) is sufficient.
  return Buffer.concat([Buffer.from([tag]), Buffer.from([val.length]), val]);
}

export type ZatcaQrFields = {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601, e.g. 2026-07-22T10:30:00Z
  total: string; // invoice total incl VAT, decimal string e.g. "1500.00"
  vatTotal: string; // VAT total, decimal string e.g. "195.65"
};

/** Build the Base64 TLV string a ZATCA Phase-1 QR encodes. */
export function buildZatcaQrBase64(f: ZatcaQrFields): string {
  return Buffer.concat([
    tlv(1, f.sellerName),
    tlv(2, f.vatNumber),
    tlv(3, f.timestamp),
    tlv(4, f.total),
    tlv(5, f.vatTotal),
  ]).toString("base64");
}

/** Integer halalas → a plain decimal SAR string ("1500.00") for the QR value fields. */
export function halalasToDecimal(halalas: number | string | null | undefined): string {
  const n = Number(halalas ?? 0) / 100;
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}
