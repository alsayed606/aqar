/**
 * Infrastructure-level Supabase/PostgREST failures, said in Arabic.
 *
 * These are not business rules — they are the database telling us something is wrong with the
 * deployment itself. The office should never read a PostgREST string, but it must not be told
 * "حدث خطأ" either: without a code, nobody can tell a missing migration from a network blip.
 */

/** PostgREST cannot see the function: it does not exist, or its schema cache is stale (PGRST202). */
const FUNCTION_MISSING = /Could not find the function|PGRST202|schema cache/i;
/** The exposed schema itself is unreachable. */
const SCHEMA_MISSING = /Could not find the schema|PGRST106/i;

export function rpcErrorAr(message: string): string | null {
  if (FUNCTION_MISSING.test(message)) {
    return "هذه الميزة غير مُفعَّلة على قاعدة البيانات بعد — تنقصها هجرة لم تُطبَّق. تواصل مع الدعم وأبلغهم بالرمز PGRST202.";
  }
  if (SCHEMA_MISSING.test(message)) {
    return "تعذّر الوصول إلى قاعدة البيانات. تواصل مع الدعم وأبلغهم بالرمز PGRST106.";
  }
  if (/fetch failed|network|ECONNREFUSED|timeout/i.test(message)) {
    return "تعذّر الاتصال بقاعدة البيانات. حاول بعد قليل.";
  }
  return null;
}
