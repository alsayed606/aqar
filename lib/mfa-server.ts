import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/provider";
import { renderOtpEmail } from "@/lib/email/templates";
import { generateOtpCode, hashOtpCode, OTP_TTL_SECONDS } from "@/lib/otp";
import { guardAuthAttempt } from "@/lib/rate-limit";
import { mfaErrorAr } from "@/lib/mfa";

// Issuing a sign-in code. Shared by enrolment (/app/security) and step-up (/auth/mfa) so the two
// paths cannot drift into different lifetimes, different limits, or different wording.
//
// SENT SYNCHRONOUSLY, NOT QUEUED. Notification mail goes into app.email_outbox and leaves on the
// daily 06:00 cron; a sign-in code that arrives tomorrow morning is not a sign-in code. This is the
// one message that must not touch the queue.

export type IssueOtpResult = { ok: true } | { ok: false; error: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function issueOtp(
  supabase: SupabaseClient<any, any, any>,
  input: { accountId: string; destination: string; purpose: "enroll" | "step_up" },
): Promise<IssueOtpResult> {
  // Each send costs us an e-mail and costs the user an interruption, so the request itself is
  // limited — otherwise anyone holding a password could flood the owner's inbox from this button.
  const throttled = await guardAuthAttempt("mfa-otp-send", input.accountId, {
    perIp: [10, 900], perTarget: [5, 900],
  });
  if (throttled) return { ok: false, error: throttled };

  const code = generateOtpCode();
  const { error } = await supabase.rpc("mfa_challenge_issue", {
    p_code_hash: hashOtpCode(code, input.accountId),
    p_purpose: input.purpose,
    p_ttl_seconds: OTP_TTL_SECONDS,
  });
  if (error) return { ok: false, error: mfaErrorAr(error.message) };

  const mail = renderOtpEmail({ code, ttlMinutes: Math.round(OTP_TTL_SECONDS / 60) });
  const sent = await sendEmail({ to: input.destination, ...mail });
  if (!sent.ok) {
    // The challenge row exists but nobody can read the code, so say so plainly rather than showing
    // a "check your inbox" screen for a message that was never sent.
    console.error(`[mfa] could not send code to account ${input.accountId}: ${sent.error}`);
    return { ok: false, error: "تعذّر إرسال الرمز إلى بريدك. حاول بعد قليل أو تواصل معنا." };
  }
  return { ok: true };
}

/** Masks an address for display: the screen must confirm WHICH inbox, not publish it. */
export function maskEmail(address: string): string {
  const [user, domain] = address.split("@");
  if (!domain) return address;
  const head = user.slice(0, 2);
  return `${head}${"•".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
