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
