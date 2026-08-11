"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailFactorState, mfaErrorAr, otpVerdictAr, recoveryVerdictAr } from "@/lib/mfa";
import { issueOtp, maskEmail } from "@/lib/mfa-server";
import {
  hashOtpCode, hashRecoveryCode, normalizeOtpInput, normalizeRecoveryCode, OTP_LENGTH,
  RECOVERY_CODE_CHARS,
} from "@/lib/otp";
import { safeReturnTo } from "@/lib/return-to";
import { guardAuthAttempt } from "@/lib/rate-limit";

export type ChallengeState = { error?: string };
export type EmailChallengeState = { sent?: boolean; notice?: string; error?: string };

// ---------------------------------------------------------------------------
// The e-mail factor's step-up (migration 0069).
// ---------------------------------------------------------------------------

/** Mails a fresh code to the enrolled destination. Also the "resend" button — the database retires
 *  the previous code, so resending never widens the set of codes that open the account. */
export async function sendStepUpCode(
  _prev: EmailChallengeState,
  _formData: FormData,
): Promise<EmailChallengeState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const factor = await emailFactorState(supabase);
  if (!factor.enabled || !factor.destination) return { error: "لا يوجد تحقّق مُفعّل على هذا الحساب." };

  const issued = await issueOtp(supabase, {
    accountId: user.id,
    destination: factor.destination,
    purpose: "step_up",
  });
  if (!issued.ok) return { error: issued.error };

  return { sent: true, notice: `أُرسل رمز جديد إلى ${maskEmail(factor.destination)}.` };
}

/** The code comes back; on success this session is marked as having satisfied the second factor. */
export async function verifyEmailChallenge(
  _prev: EmailChallengeState,
  formData: FormData,
): Promise<EmailChallengeState> {
  const code = normalizeOtpInput(String(formData.get("code") ?? ""));
  const returnTo = String(formData.get("returnTo") ?? "");
  if (code.length !== OTP_LENGTH) return { sent: true, error: "أدخل الرمز المكوّن من ٦ أرقام." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const throttled = await guardAuthAttempt("mfa-email-verify", user.id, {
    perIp: [20, 900], perTarget: [10, 900],
  });
  if (throttled) return { sent: true, error: throttled };

  const { data, error } = await supabase.rpc("mfa_challenge_verify", {
    p_code_hash: hashOtpCode(code, user.id),
    p_purpose: "step_up",
  });
  if (error) return { sent: true, error: mfaErrorAr(error.message) };

  const refusal = otpVerdictAr(String(data));
  if (refusal) return { sent: true, error: refusal };

  redirect(safeReturnTo(returnTo) ?? "/app");
}

// ---------------------------------------------------------------------------
// Recovery, exit one: a code off the sheet the user printed at enrolment (migration 0071).
// ---------------------------------------------------------------------------

export type RecoveryState = { error?: string };

/** Spends one recovery code. Full standing on success — this lands the user in the app, not in a
 *  restricted session: a fifty-bit secret they stored offline is not weaker than the lost phone. */
export async function useRecoveryCode(
  _prev: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const code = normalizeRecoveryCode(String(formData.get("code") ?? ""));
  const returnTo = String(formData.get("returnTo") ?? "");
  // Exactly ten symbols, never eight or nine. A looser check spends one of only five attempts per
  // quarter hour on an input that cannot possibly be right — and it spends it on someone who is
  // already locked out, which is the worst moment to be rate-limited for a typo.
  if (code.length !== RECOVERY_CODE_CHARS) {
    return { error: "أدخل رمز استرداد كاملاً كما هو في قائمتك (عشرة أحرف وأرقام)." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Tighter than the six-digit limits: a recovery code is the strongest thing a stolen password can
  // be paired with, and unlike an e-mail code it does not expire on its own in ten minutes.
  const throttled = await guardAuthAttempt("mfa-recovery-code", user.id, {
    perIp: [10, 900], perTarget: [5, 900],
  });
  if (throttled) return { error: throttled };

  const { data, error } = await supabase.rpc("mfa_recovery_consume", {
    p_code_hash: hashRecoveryCode(code, user.id),
  });
  if (error) return { error: mfaErrorAr(error.message) };

  const refusal = recoveryVerdictAr(String(data));
  if (refusal) return { error: refusal };

  // Straight to the security page, not to where they were headed: they have just spent one of a
  // finite set, and the moment to print a new sheet is now, while they are thinking about it.
  redirect(`/app/security?recovery=used&returnTo=${encodeURIComponent(safeReturnTo(returnTo) ?? "/app")}`);
}

// ---------------------------------------------------------------------------
// Recovery, exit two: an e-mail code for someone whose authenticator is gone AND who saved no
// codes. Weaker than the factor it bypasses, so it opens a RESTRICTED session (see 0071).
// ---------------------------------------------------------------------------

/** Mails a recovery code to the account's own address. */
export async function sendRecoveryEmailCode(
  _prev: EmailChallengeState,
  _formData: FormData,
): Promise<EmailChallengeState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Offered only where it is actually a bypass: a pending TOTP factor. Without this check the
  // action would be a second, permanently weaker door into every account that has no TOTP at all.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!(aal?.nextLevel === "aal2" && aal.currentLevel === "aal1")) {
    return { error: "لا حاجة لهذا هنا." };
  }

  // The account's own address, from the verified session — never from the form, for the reason
  // startEmailEnrollment gives: a destination the page could choose is not a second factor.
  const destination = user.email;
  if (!destination) {
    return { error: "لا يوجد بريد على حسابك، فلا يمكن إرسال رمز الاسترداد. تواصل معنا." };
  }

  const issued = await issueOtp(supabase, {
    accountId: user.id,
    destination,
    purpose: "recovery",
  });
  if (!issued.ok) return { error: issued.error };

  return { sent: true, notice: `أُرسل رمز استرداد إلى ${maskEmail(destination)}.` };
}

/** Verifies it, and lands the user in the restricted session the middleware confines. */
export async function verifyRecoveryEmailCode(
  _prev: EmailChallengeState,
  formData: FormData,
): Promise<EmailChallengeState> {
  const code = normalizeOtpInput(String(formData.get("code") ?? ""));
  if (code.length !== OTP_LENGTH) return { sent: true, error: "أدخل الرمز المكوّن من ٦ أرقام." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const throttled = await guardAuthAttempt("mfa-recovery-email", user.id, {
    perIp: [20, 900], perTarget: [10, 900],
  });
  if (throttled) return { sent: true, error: throttled };

  const { data, error } = await supabase.rpc("mfa_challenge_verify", {
    p_code_hash: hashOtpCode(code, user.id),
    p_purpose: "recovery",
  });
  if (error) return { sent: true, error: mfaErrorAr(error.message) };

  const refusal = otpVerdictAr(String(data));
  if (refusal) return { sent: true, error: refusal };

  // No returnTo. This session is restricted to exactly one page, and pretending otherwise would
  // only produce a redirect the middleware immediately overrules.
  redirect("/app/security?recovery=1");
}

// The step-up screen: the session is authenticated but has not yet used the second factor.
export async function verifyChallenge(
  _prev: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (code.length !== 6) return { error: "أدخل الرمز المكوّن من ٦ أرقام." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Six digits is a million possibilities, and a stolen password is what gets an attacker to this
  // screen. Without a limit the second factor would only slow them down.
  const throttled = await guardAuthAttempt("mfa-verify", user.id, {
    perIp: [20, 900], perTarget: [10, 900],
  });
  if (throttled) return { error: throttled };

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: mfaErrorAr(listError.message) };
  const factor = (factors?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) redirect(safeReturnTo(returnTo) ?? "/app");

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError) return { error: mfaErrorAr(challengeError.message) };

  const { error } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  });
  if (error) return { error: mfaErrorAr(error.message) };

  redirect(safeReturnTo(returnTo) ?? "/app");
}

// Signing out is the only way past this screen. Offered explicitly so a user on a device without
// their authenticator is not trapped on a page with no exit.
export async function abandonChallenge() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
