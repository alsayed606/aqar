"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { mfaErrorAr } from "@/lib/mfa";
import { guardAuthAttempt } from "@/lib/rate-limit";

export type EnrollState = {
  factorId?: string;
  qrSvg?: string;
  secret?: string;
  error?: string;
};

export type VerifyState = { error?: string };

// Step 1 — create an unverified TOTP factor and render its QR locally.
//
// Supabase also returns a ready-made `qr_code` SVG, but drawing it ourselves from the `uri` avoids
// injecting a third-party HTML string into the page, which our CSP is written to prevent. `qrcode`
// is already a dependency (the ZATCA invoice QR uses it), so this costs nothing.
export async function startEnrollment(): Promise<EnrollState> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `عقار — ${new Date().toLocaleDateString("ar-SA")}`,
  });
  if (error) return { error: mfaErrorAr(error.message) };

  const qrSvg = await QRCode.toString(data.totp.uri, { type: "svg", margin: 1, width: 200 });
  // The secret is shown alongside the QR for authenticator apps that cannot scan.
  return { factorId: data.id, qrSvg, secret: data.totp.secret };
}

// Step 2 — prove the user's app is generating the right codes before the factor goes live. Until
// this succeeds the factor stays unverified and does not gate anything.
export async function confirmEnrollment(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const factorId = String(formData.get("factor_id") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (!factorId) return { error: "ابدأ التفعيل من جديد." };
  if (code.length !== 6) return { error: "أدخل الرمز المكوّن من ٦ أرقام." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // A six-digit code is guessable at scale; without a limit an attacker with a stolen password
  // could walk the whole space.
  const throttled = await guardAuthAttempt("mfa-enroll", user.id, {
    perIp: [20, 900], perTarget: [10, 900],
  });
  if (throttled) return { error: throttled };

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) return { error: mfaErrorAr(challengeError.message) };

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (error) return { error: mfaErrorAr(error.message) };

  revalidatePath("/app/security");
  redirect("/app/security?ok=enrolled");
}

// Removing a factor is itself a security-relevant act: whoever can remove it can undo the
// protection. Supabase requires an aal2 session to unenroll, which is the check that matters.
export async function removeFactor(formData: FormData) {
  const factorId = String(formData.get("factor_id") ?? "");
  if (!factorId) redirect("/app/security");

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) redirect(`/app/security?error=${encodeURIComponent(mfaErrorAr(error.message))}`);

  revalidatePath("/app/security");
  redirect("/app/security?ok=removed");
}
