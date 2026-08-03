import { createClient } from "@/lib/supabase/server";
import type { MeterProperty } from "@/components/meter-form";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Every property with its units, so the add-meter form can narrow the unit list without a round
 * trip. RLS already limits both to what this member may see.
 */
export async function loadMeterProperties(): Promise<MeterProperty[]> {
  const supabase = await createClient();
  const [{ data: props }, { data: units }] = await Promise.all([
    supabase.from("property").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("unit").select("id, unit_number, property_id").is("deleted_at", null).order("unit_number"),
  ]);
  const byProperty = new Map<string, { id: string; label: string }[]>();
  for (const u of units ?? []) {
    const list = byProperty.get(u.property_id) ?? [];
    list.push({ id: u.id, label: u.unit_number });
    byProperty.set(u.property_id, list);
  }
  return (props ?? []).map((p: any) => ({ id: p.id, label: p.name, units: byProperty.get(p.id) ?? [] }));
}
