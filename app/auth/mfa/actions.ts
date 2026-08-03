"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mfaErrorAr } from "@/lib/mfa";
import { safeReturnTo } from "@/lib/return-to";
import { guardAuthAttempt } from "@/lib/rate-limit";

export type ChallengeState = { error?: string };

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
