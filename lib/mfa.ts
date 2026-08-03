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

export function mfaErrorAr(message: string): string {
  if (/invalid.*code|invalid.*totp|verification failed/i.test(message)) return "الرمز غير صحيح. تحقّق من التطبيق وأعِد المحاولة.";
  if (/expired/i.test(message)) return "انتهت صلاحية الرمز. أدخل الرمز الظاهر الآن.";
  if (/rate|too many/i.test(message)) return "محاولات كثيرة. انتظر قليلاً ثم أعِد المحاولة.";
  if (/already.*enrolled|already exists/i.test(message)) return "لديك عامل تحقّق مُفعّل بهذا الاسم.";
  if (/aal2|assurance/i.test(message)) return "أكمِل التحقّق بخطوتين أولاً.";
  return message;
}
