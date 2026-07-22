/* eslint-disable @typescript-eslint/no-explicit-any */
// Supabase returns an embedded to-one relation as either a single object or a one-element array
// depending on the query shape. `first` normalizes that to the single row (or undefined).
export function first(x: any): any {
  return Array.isArray(x) ? x[0] : x;
}
