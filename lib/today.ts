/**
 * Today, where the office is.
 *
 * `new Date().toISOString().slice(0, 10)` is UTC, and Riyadh is UTC+3 — so between midnight and 3am
 * local it names YESTERDAY. Every default date in the product was written that way, and each one is
 * a record dated a day early for whoever works late: a payout, a meter removal, a bill marked paid.
 *
 * The rule lived in four places before it lived here, and it had already been fixed in one of them
 * privately. That is the moment to move it: the same knowledge written more than once drifts, and
 * this one drifts silently — nobody notices a date that is off by one until they reconcile.
 *
 * The database says the same thing in SQL (`now() at time zone 'Asia/Riyadh'`, e.g. 0072's daily
 * limit and 0083's valid_from). This is that rule for the code that cannot ask the database.
 */
const OFFICE_TIME_ZONE = "Asia/Riyadh";

/** `YYYY-MM-DD` for today in Riyadh — the shape every `<input type="date">` and `date` column wants. */
export function riyadhToday(): string {
  // en-CA formats as YYYY-MM-DD, which is what makes this a one-liner rather than three getters.
  return new Date().toLocaleDateString("en-CA", { timeZone: OFFICE_TIME_ZONE });
}
