"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeSaudiPhone } from "@/lib/phone";

export type LoginState = {
  step: "phone" | "code";
  phone?: string;
  error?: string;
};

// Step 1 — send the OTP to the phone (Supabase Auth manages hashing/expiry/rate-limit/single-use).
export async function sendOtp(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = String(formData.get("phone") ?? "");
  const phone = normalizeSaudiPhone(raw);
  if (!phone) {
    return { step: "phone", error: "رقم جوال غير صالح. مثال: 05XXXXXXXX" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) {
    return { step: "phone", phone, error: error.message };
  }
  return { step: "code", phone };
}

// Step 2 — verify the OTP; on success Supabase sets the session cookies and we enter the app.
export async function verifyOtp(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const phone = String(formData.get("phone") ?? "");
  const token = String(formData.get("code") ?? "").replace(/[^0-9]/g, "");
  if (!phone || token.length < 4) {
    return { step: "code", phone, error: "أدخل الرمز المكوّن من 6 أرقام." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) {
    return { step: "code", phone, error: error.message };
  }

  redirect("/app");
}
