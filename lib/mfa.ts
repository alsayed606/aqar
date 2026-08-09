import type { SupabaseClient } from "@supabase/supabase-js";

// Two-factor authentication, on Supabase's TOTP factors.
//
// The only state that matters is the Authenticator Assurance Level. Supabase reports two:
//   currentLevel — what this session has actually proven
//   nextLevel    — what it COULD prove, i.e. aal2 once a verified factor exists
// So "enrolled but not yet verified in this session" is exactly current=aal1 && next=aal2, and that
// is the one condition worth a name.

export type MfaStatus = {
  enrolled: boolean;
  /** A verified factor exists but this session has not used it yet — step up before proceeding. */
  stepUpRequired: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function mfaStatus(supabase: SupabaseClient<any, any, any>): Promise<MfaStatus> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Fail CLOSED is wrong here and fail open is wrong too, so: treat an unreadable level as
  // "not enrolled". A user who cannot be asked for a second factor must still be able to sign in
  // with the first, and every gate that matters re-checks the level itself rather than trusting this.
  if (error || !data) return { enrolled: false, stepUpRequired: false };
  return {
    enrolled: data.nextLevel === "aal2",
    stepUpRequired: data.nextLevel === "aal2" && data.currentLevel === "aal1",
  };
}

// ---------------------------------------------------------------------------
// The e-mail factor (migration 0069) — our own, because GoTrue has no e-mail factor and its
// assurance level therefore cannot describe one.
// ---------------------------------------------------------------------------

/** How the session in hand proved itself — see the `method` column in migration 0070. */
export type StepUpMethod = "factor" | "recovery_code" | "email_fallback";

export type EmailFactorState = {
  enabled: boolean;
  channel: string;
  destination: string | null;
  steppedUp: boolean;
  /** Null when this session has not stepped up at all. */
  method: StepUpMethod | null;
  /** Unused recovery codes left on the account (0070). */
  codesLeft: number;
  /**
   * True when the only thing this session proved is an e-mail code sent to bypass a lost
   * authenticator. Weaker than the factor it stands in for, so it buys the security page and
   * nothing else — the middleware enforces that, and every screen reads it from here.
   */
  restricted: boolean;
};

const NO_FACTOR: EmailFactorState = {
  enabled: false, channel: "email", destination: null,
  steppedUp: false, method: null, codesLeft: 0, restricted: false,
};

/**
 * Reads app.mfa_state() for the caller's own account and session.
 *
 * Unreadable state is reported as "no factor", matching mfaStatus above: a person who cannot be
 * asked for a second factor must still be able to use the first, and every gate re-reads this
 * itself rather than caching a verdict.
 */
export async function emailFactorState(supabase: SupabaseClient<any, any, any>): Promise<EmailFactorState> {
  const { data, error } = await supabase.rpc("mfa_state");
  if (error) return NO_FACTOR;
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        enabled: boolean; channel: string; destination: string | null; stepped_up: boolean;
        step_up_method: StepUpMethod | null; codes_left: number | null;
      }
    | undefined;
  if (!row) return NO_FACTOR;
  const method = row.stepped_up === true ? row.step_up_method ?? "factor" : null;
  return {
    enabled: row.enabled === true,
    channel: row.channel ?? "email",
    destination: row.destination,
    steppedUp: row.stepped_up === true,
    method,
    codesLeft: Number(row.codes_left ?? 0),
    restricted: method === "email_fallback",
  };
}

/** The verdicts app.mfa_challenge_verify returns, in the words the user reads. */
export function otpVerdictAr(verdict: string): string | null {
  switch (verdict) {
    case "OK":
      return null;
    case "NO_CHALLENGE":
      return "لا يوجد رمز فعّال. اطلب رمزاً جديداً.";
    case "EXPIRED":
      return "انتهت صلاحية الرمز. اطلب رمزاً جديداً.";
    case "TOO_MANY_ATTEMPTS":
      return "استُهلكت محاولات هذا الرمز. اطلب رمزاً جديداً.";
    case "BAD_CODE":
      return "الرمز غير صحيح. تحقّق من البريد وأعِد المحاولة.";
    default:
      return "تعذّر التحقّق من الرمز. أعِد المحاولة.";
  }
}

/** app.mfa_recovery_consume returns one of two words, and only one of them is a refusal. */
export function recoveryVerdictAr(verdict: string): string | null {
  if (verdict === "OK") return null;
  // "Wrong" and "already used" are one sentence on purpose — the database refuses to tell them
  // apart, and the screen must not undo that by guessing.
  return "رمز الاسترداد غير صحيح أو سبق استخدامه. جرّب رمزاً آخر من قائمتك.";
}

export function mfaErrorAr(message: string): string {
  if (/BAD_CODE_SET/.test(message)) return "تعذّر توليد رموز الاسترداد. أعِد المحاولة.";
  // Raised by name from migration 0069 and arriving inside PostgREST's message text.
  if (/STEP_UP_REQUIRED/.test(message)) return "أدخل الرمز أولاً، ثم يمكنك تعطيل التحقّق.";
  if (/NO_SESSION/.test(message)) return "انتهت جلستك. سجّل الدخول ثم أعِد المحاولة.";
  if (/CHANNEL_UNAVAILABLE/.test(message)) return "الإرسال بالرسائل النصية غير متاح بعد.";
  if (/DESTINATION_REQUIRED/.test(message)) return "لا يوجد بريد على حسابك. أضِفه أولاً.";
  if (/invalid.*code|invalid.*totp|verification failed/i.test(message)) return "الرمز غير صحيح. تحقّق من التطبيق وأعِد المحاولة.";
  if (/expired/i.test(message)) return "انتهت صلاحية الرمز. أدخل الرمز الظاهر الآن.";
  if (/rate|too many/i.test(message)) return "محاولات كثيرة. انتظر قليلاً ثم أعِد المحاولة.";
  if (/already.*enrolled|already exists/i.test(message)) return "لديك عامل تحقّق مُفعّل بهذا الاسم.";
  if (/aal2|assurance/i.test(message)) return "أكمِل التحقّق بخطوتين أولاً.";
  return message;
}
