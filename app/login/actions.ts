"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeSaudiPhone } from "@/lib/phone";
import { safeReturnTo } from "@/lib/return-to";
import { translateAuthError } from "@/lib/auth-errors";

export type LoginState = {
  step: "phone" | "code";
  phone?: string;
  error?: string;
};

// ── Email + password (the active auth path; Sprint E) ──────────────────────────────────────────
export type EmailAuthState = { mode: "signin" | "signup"; error?: string; notice?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// One action for both sign-in and sign-up (branch on the `mode` field), mirroring the useActionState
// pattern used elsewhere. Future-proof: sign-up tolerates a null session (returned once email
// confirmation is switched ON in Supabase) by showing a "check your inbox" notice instead of failing.
export async function emailAuth(
  _prev: EmailAuthState,
  formData: FormData,
): Promise<EmailAuthState> {
  const mode = String(formData.get("mode") ?? "signin") === "signup" ? "signup" : "signin";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");

  if (!EMAIL_RE.test(email)) return { mode, error: "أدخل بريداً إلكترونياً صالحاً." };
  if (password.length < 8) return { mode, error: "كلمة المرور يجب أن تكون ٨ أحرف على الأقل." };

  const supabase = await createClient();

  if (mode === "signup") {
    const fullName = String(formData.get("full_name") ?? "").trim();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: fullName ? { data: { full_name: fullName } } : undefined,
    });
    if (error) return { mode, error: translateAuthError(error.message) };
    // Confirmation OFF → a session is returned and cookies are set → enter the app.
    // Confirmation ON (later) → no session → tell the user to confirm, then sign in.
    if (!data.session) {
      return { mode: "signin", notice: "أنشأنا حسابك. فعّل الحساب من رابط التأكيد في بريدك ثم سجّل الدخول." };
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { mode, error: translateAuthError(error.message) };
  }

  redirect(safeReturnTo(returnTo) ?? "/app");
}

// ── Phone OTP (retained but DORMANT; not surfaced in the UI) ──────────────────────────────────
// Kept intact for the future phone-verification sprint. Real SMS is not wired yet (ADR-0001), so the
// active auth path is email+password above; these are not linked from /login.

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

  // Land where the user was headed before login (validated), else the app home.
  redirect(safeReturnTo(String(formData.get("returnTo") ?? "")) ?? "/app");
}
