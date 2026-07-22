"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function acceptOwnerInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/portal/join?error=missing");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_owner_invitation", { p_token: token });
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
