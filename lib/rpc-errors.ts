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

/**
 * What a write says when row-level security refused it.
 *
 * A policy does not raise an error — it matches zero rows. So an UPDATE the reader was never allowed
 * to make returns `error: null`, and an action that only checks `error` reports success for a write
 * that never happened. Every UPDATE therefore asks for `.select("id")` and treats an empty result as
 * this refusal.
 *
 * The sentence covers both causes on purpose: the row may be outside the member's property scope, or
 * it may have been archived by someone else while the form was open. We cannot tell which from here,
 * and guessing would be worse than naming both.
 */
export const WRITE_REFUSED_AR =
  "لم يُحفَظ التغيير: إمّا أن السجل خارج نطاق صلاحيتك، أو أنه لم يعد موجوداً. حدّث الصفحة وتحقّق.";

/** True when an UPDATE matched nothing — the shape every `.select("id")` write returns. */
export function writeRefused(rows: { id: string }[] | null): boolean {
  return !rows || rows.length === 0;
}
