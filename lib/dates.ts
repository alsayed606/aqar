/** ISO date (YYYY-MM-DD) for `days` before today, in UTC. Used for default statement windows. */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
