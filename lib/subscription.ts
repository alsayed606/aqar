// Shared shape + pure helpers for the subscription surfaces (the page and the app-layout banner).
// Mirrors the jsonb returned by app.subscription_summary(org) (migration 0036).

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "comped";

export type Summary = {
  plan_code: string;
  plan_name: string;
  price_halalas: number;
  status: SubscriptionStatus;
  active: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  auto_renew: boolean;
  card: { brand: string | null; last4: string | null } | null;
  limits: { properties: number | null; units: number | null; members: number | null };
  usage: { properties: number; units: number; members: number };
};

/** timestamptz ISO string → an unambiguous Gregorian YYYY-MM-DD (or an em dash). */
export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
}

/** Whole days from now until `iso` (negative once past). null when there is no date. */
export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
