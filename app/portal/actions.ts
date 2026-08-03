"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp, throttledMessage } from "@/lib/rate-limit";

// Generic portal-invite accept — handles both owner and tenant invites.
export async function acceptPortalInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/portal/join?error=missing");

  // Per address, not per token: bucketing by the token would reset the allowance on every guess,
  // which is exactly the behaviour a brute-force needs.
  const attempt = await rateLimit("portal-join:ip", await clientIp(), 10, 900);
  if (!attempt.allowed) {
    redirect(`/portal/join?error=${encodeURIComponent(throttledMessage(attempt.retryAfter))}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_portal_invitation", { p_token: token });
  if (error) {
    const msg = /INVITATION_INVALID/i.test(error.message)
      ? "الرابط غير صالح أو منتهٍ أو مستخدم"
      : /ALREADY_LINKED/i.test(error.message)
        ? "هذا الملف مرتبط بحساب آخر"
        : error.message;
    redirect(`/portal/join?token=${encodeURIComponent(token)}&error=${encodeURIComponent(msg)}`);
  }
  redirect("/portal");
}

export async function signOutPortal() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
