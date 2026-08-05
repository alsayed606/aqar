/**
 * What activating a contract will actually charge — computed on the screen before it happens.
 *
 * This is a MIRROR of app.activate_contract (migration 0019), not a second opinion. The database
 * stays the only thing that creates charges; this exists so the office sees the schedule before it
 * commits to it, instead of discovering it afterwards on the contract page.
 *
 * Two details are copied deliberately rather than simplified:
 *
 *   1. The annual rent is split by integer division and **the remainder rides on the last
 *      instalment**. Dividing evenly on screen would show a figure no invoice will ever carry.
 *   2. VAT is rounded **per instalment and then summed** — not taken on the annual total. The two
 *      differ by up to a halala per period, and the office reconciles against the invoices.
 *
 * Everything is integer halalas end to end. The VAT line uses exact integer arithmetic instead of
 * `amount * 0.15`, because a float lands on the wrong side of a half-halala often enough to make
 * the screen disagree with the database over a single satang.
 */

/** Commercial rent is 15%; residential rent is exempt. Mirrors the branch in 0019. */
export const VAT_RATE_BPS = { commercial: 1500, residential: 0 } as const;

export type ContractKind = keyof typeof VAT_RATE_BPS;

/** Instalment count per payment frequency. `one_time` and anything unknown fall to a single charge. */
const PERIODS: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  semi_annual: 2,
  annual: 1,
  one_time: 1,
};

export type ContractFinance = {
  periods: number;
  rentExcl: number;
  vat: number;
  total: number;
  /** The instalment paid in every period but the last. */
  instalment: number;
  /** The last one carries the rounding remainder, so it can be a halala or two larger. */
  lastInstalment: number;
  instalmentTotal: number;
  lastInstalmentTotal: number;
};

/** Round half away from zero, in integers, so the result matches Postgres `round(numeric)`. */
function vatOf(amountHalalas: number, rateBps: number): number {
  return Math.floor((amountHalalas * rateBps + 5000) / 10000);
}

export function contractFinance(
  annualRentHalalas: number,
  kind: string,
  frequency: string,
): ContractFinance | null {
  if (!Number.isFinite(annualRentHalalas) || annualRentHalalas <= 0) return null;

  const periods = PERIODS[frequency] ?? 1;
  const rateBps = VAT_RATE_BPS[kind as ContractKind] ?? VAT_RATE_BPS.residential;

  const base = Math.floor(annualRentHalalas / periods);
  const last = base + (annualRentHalalas - base * periods);

  const baseVat = vatOf(base, rateBps);
  const lastVat = vatOf(last, rateBps);
  const vat = baseVat * (periods - 1) + lastVat;

  return {
    periods,
    rentExcl: annualRentHalalas,
    vat,
    total: annualRentHalalas + vat,
    instalment: base,
    lastInstalment: last,
    instalmentTotal: base + baseVat,
    lastInstalmentTotal: last + lastVat,
  };
}
