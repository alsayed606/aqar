"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailFactorState, mfaErrorAr, otpVerdictAr } from "@/lib/mfa";
import { issueOtp, maskEmail } from "@/lib/mfa-server";
import { hashOtpCode, normalizeOtpInput, OTP_LENGTH } from "@/lib/otp";
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
