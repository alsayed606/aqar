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

/** The refusals one module knows how to translate: a database code, and what it means to the office. */
export type Refusals = ReadonlyArray<readonly [RegExp, string]>;

/**
 * Turn whatever the database said into a sentence the office can act on.
 *
 * Each module keeps its own table because the codes are its own — `CONTRACT_NOT_ACTIVE` means nothing
 * to the invoice screen. What is shared is the ORDER and, more importantly, the last step: an
 * untranslated message is logged and replaced, never shown.
 *
 * Before this, an unrecognised failure reached the office as raw English from PostgREST — on an
 * Arabic screen, naming columns it has never heard of. That is not an error message; it is the
 * absence of one, and it teaches the reader that the product breaks in a language it does not speak.
 */
export function refusalAr(message: string, known: Refusals): string {
  const said = known.find(([pattern]) => pattern.test(message))?.[1];
  if (said) return said;

  const infrastructure = rpcErrorAr(message);
  if (infrastructure) return infrastructure;

  // Kept where an operator can find it. The office gets a sentence; the cause is not thrown away.
  console.error("[rpc]", message);
  return "تعذّر إتمام العملية. حدّث الصفحة وحاول مرّة أخرى، وإن تكرّر فأبلغ الدعم.";
}
