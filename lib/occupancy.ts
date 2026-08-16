/**
 * Occupancy, defined once.
 *
 * The definition is a decision, not arithmetic: the denominator is EVERY unit, not just the rented
 * and the vacant. A unit under maintenance or out of service is a unit the office owns and is not
 * collecting on — leaving it out would report a higher occupancy than the building has.
 *
 * It lived in two places (a card and a report) that disagreed about what to show for a property with
 * no units at all. One of them had to be wrong on any screen showing both.
 */

/** Percent rented, rounded. Zero units → null: there is no ratio to state, and 0% would be a lie. */
export function occupancyPercent(rented: number, units: number): number | null {
  return units === 0 ? null : Math.round((rented / units) * 100);
}

/** The same number as text, with the one agreed placeholder for "no units". */
export function occupancyLabel(rented: number, units: number): string {
  const percent = occupancyPercent(rented, units);
  return percent === null ? "—" : `${percent}%`;
}
