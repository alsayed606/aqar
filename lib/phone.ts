/**
 * Saudi mobile → strict E.164 (+9665XXXXXXXX). Mirror of app.normalize_phone_e164 in the DB
 * (migration 0003) so the client normalizes before calling Supabase Auth. Returns null if invalid.
 * Accepts 05…, ٠٥…, 5…, 9665…, +966 5…, 00966…, with spaces/dashes and Arabic-Indic digits.
 */
const AR = "٠١٢٣٤٥٦٧٨٩";
const FA = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeSaudiPhone(input: string): string | null {
  if (!input) return null;

  const folded = input.replace(/[٠-٩۰-۹]/g, (d) => {
    const a = AR.indexOf(d);
    if (a >= 0) return String(a);
    const f = FA.indexOf(d);
    return f >= 0 ? String(f) : d;
  });

  let s = folded.replace(/[^0-9]/g, "");
  if (s.startsWith("00966")) s = s.slice(5);
  else if (s.startsWith("966")) s = s.slice(3);
  else if (s.startsWith("0")) s = s.slice(1);

  return /^5[0-9]{8}$/.test(s) ? "+966" + s : null;
}
