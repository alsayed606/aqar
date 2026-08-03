import { UTILITY_TYPE_AR } from "@/lib/labels";

/**
 * How a meter is named everywhere it is picked or listed: what it is, its number, and what it
 * serves. Meter numbers alone are indistinguishable once an office has more than a few.
 */
export function meterLabel(m: {
  utility_type: string;
  meter_number: string;
  unit_number?: string | null;
  property_name?: string | null;
}): string {
  const type = UTILITY_TYPE_AR[m.utility_type] ?? m.utility_type;
  const serves = m.unit_number ? `وحدة ${m.unit_number}` : "رئيسي";
  const where = m.property_name ? ` — ${m.property_name}` : "";
  return `${type} ${m.meter_number} (${serves})${where}`;
}

/** The first day of each of the last `count` months, oldest first, as YYYY-MM-DD. */
export function lastMonths(count: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(d.toISOString().slice(0, 10));
  }
  return months;
}
