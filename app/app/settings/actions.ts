"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";
import { parseOrgProfile, orgWriteError } from "@/lib/org-profile";
import { translateAuthError } from "@/lib/auth-errors";
import { guardAuthAttempt } from "@/lib/rate-limit";
import type { FormState } from "@/lib/form-state";

const LOGO_BUCKET = "org-assets";
const LOGO_MAX_BYTES = 512 * 1024;

// ── The organization's own profile ───────────────────────────────────────────────────────────────

export async function updateOrgProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const { values, error, field } = parseOrgProfile(formData);
  // `values` rides along on every refusal: React resets the form when the action resolves, so the
  // inputs default to whatever we hand back — and handing back the stored row would erase the edit.
  if (error) return { error, field, values };

  const supabase = await createClient();
  const { data, error: writeError } = await supabase
    .from("organization")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", activeOrg)
    .select("id");

  if (writeError) return { ...orgWriteError(writeError.message), values };

  // A member who is not an admin passes the SELECT policy and fails the UPDATE one, and an UPDATE
  // that matches no row is not an error — it reports success having changed nothing. Asking for the
  // affected rows back is what turns that silence into a message.
  if (!data || data.length === 0) return { error: "تعديل بيانات المنشأة متاح للمدراء فقط", values };

  revalidatePath("/app/settings");
  revalidatePath("/app");
  return { ok: "حُفظت بيانات المنشأة." };
}

// ── Logo ─────────────────────────────────────────────────────────────────────────────────────────

// The declared Content-Type is whatever the browser (or a hand-made request) says it is. These are
// the first bytes of the file itself, which is the part a renderer will actually act on.
function imageExtension(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  if (bytes.length >= 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const ascii = (from: number, text: string) =>
    [...text].every((ch, i) => bytes[from + i] === ch.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  return null;
}

const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

export async function uploadOrgLogo(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "اختر ملف الشعار أولاً" };
  if (file.size > LOGO_MAX_BYTES) return { error: "حجم الشعار يجب أن يكون أقل من ٥٠٠ كيلوبايت" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = imageExtension(bytes);
  if (!ext) return { error: "الشعار يجب أن يكون صورة PNG أو JPG أو WEBP" };

  const supabase = await createClient();
  const path = `${activeOrg}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: MIME_BY_EXT[ext], upsert: true });
  if (uploadError) {
    if (/row-level security|not authorized|Unauthorized/i.test(uploadError.message)) {
      return { error: "رفع الشعار متاح للمدراء فقط" };
    }
    if (/Bucket not found/i.test(uploadError.message)) {
      return { error: "لم تُنشأ مساحة التخزين بعد — طبّق الهجرة 0066" };
    }
    return { error: uploadError.message };
  }

  // Replacing a PNG with a WEBP writes a new object; without this the old one would stay in the
  // bucket, unreferenced and unreachable, for as long as the project lives.
  const { data: current } = await supabase.from("organization").select("logo_path").eq("id", activeOrg).maybeSingle();
  if (current?.logo_path && current.logo_path !== path) {
    await supabase.storage.from(LOGO_BUCKET).remove([current.logo_path]);
  }

  const { data, error: linkError } = await supabase
    .from("organization")
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq("id", activeOrg)
    .select("id");
  if (linkError) return orgWriteError(linkError.message);
  if (!data || data.length === 0) return { error: "رفع الشعار متاح للمدراء فقط" };

  revalidatePath("/app/settings");
  return { ok: "حُدّث الشعار." };
}

export async function removeOrgLogo(_prev: FormState): Promise<FormState> {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data: current } = await supabase.from("organization").select("logo_path").eq("id", activeOrg).maybeSingle();

  const { data, error } = await supabase
    .from("organization")
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq("id", activeOrg)
    .select("id");
  if (error) return orgWriteError(error.message);
  if (!data || data.length === 0) return { error: "حذف الشعار متاح للمدراء فقط" };

  // The row is cleared first on purpose: if the object delete fails the page stops showing a logo
  // it can no longer fetch, instead of keeping a link to a file that may or may not be gone.
  if (current?.logo_path) await supabase.storage.from(LOGO_BUCKET).remove([current.logo_path]);

  revalidatePath("/app/settings");
  return { ok: "أُزيل الشعار." };
}

// ── The signed-in person ─────────────────────────────────────────────────────────────────────────
//
// These three return their outcome instead of redirecting, and the difference is not cosmetic. A
// redirect reloads the page: the message lands at the top, far from the field that caused it, AND
// every value the user typed is gone — so the reader who finally notices the warning has nothing
// left to correct. Returning state keeps the message under its own field and the input where it was.
//
// The org-profile actions above still redirect. They are the next step, not this one.

export type AccountFormState = FormState;

export async function updateMyProfile(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/settings");

  const full_name = String(formData.get("full_name") ?? "").trim() || null;
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  // Echoed on every refusal — see FormState.values for why an untouched form still loses its input.
  const typed = { full_name, phone: phoneRaw || null };

  let phone_e164: string | null = null;
  if (phoneRaw) {
    phone_e164 = normalizeSaudiPhone(phoneRaw);
    if (!phone_e164) return { error: "رقم جوال غير صالح (مثال: 05XXXXXXXX)", field: "phone", values: typed };
  }

  const { error } = await supabase
    .from("identity")
    .update({ full_name, phone_e164, phone_raw: phoneRaw || null, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    if (/identity_contact_present/.test(error.message)) {
      return { error: "لا يمكن ترك الجوال والبريد فارغين معاً", field: "phone", values: typed };
    }
    if (/duplicate|unique/i.test(error.message)) {
      return { error: "هذا الجوال مسجّل لحساب آخر", field: "phone", values: typed };
    }
    return { error: error.message, values: typed };
  }

  revalidatePath("/app/settings");
  return { ok: "حُفظت بياناتك." };
}

export async function changeEmail(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Echoed on every refusal — see FormState.values.
  const typed = { email };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "أدخل بريداً إلكترونياً صالحاً", field: "email", values: typed };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/settings");
  if (user.email?.toLowerCase() === email) return { error: "هذا هو بريدك الحالي", field: "email", values: typed };

  // Changing the login address is an account-takeover step if it is ever done by someone else, so it
  // is throttled like a sign-in attempt.
  const throttled = await guardAuthAttempt("email-change", user.id, { perIp: [5, 3600], perTarget: [3, 3600] });
  if (throttled) return { error: throttled, field: "email", values: typed };

  const { error } = await supabase.auth.updateUser({ email });
  if (error) {
    // translateAuthError answers this case with "sign in instead of registering", which is the
    // sign-up wording and nonsense on a settings page. Said here in the words of what just happened.
    const taken = /already registered|already.*exists|user already|email.*taken/i.test(error.message);
    return {
      error: taken ? "هذا البريد مسجَّل لحساب آخر. اختر بريداً غيره." : translateAuthError(error.message),
      field: "email",
      values: typed,
    };
  }

  // The address does not change until the link is opened. app.identity follows automatically then,
  // through the auth.users trigger added in 0066.
  return { ok: "أرسلنا رابط تأكيد إلى بريدك الجديد. لن يتغيّر البريد قبل فتحه." };
}

export async function changePassword(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  if (next.length < 8) return { error: "كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل", field: "new_password" };
  if (next === current) return { error: "كلمة المرور الجديدة مطابقة للحالية", field: "new_password" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/settings");
  if (!user.email) return { error: "لا يوجد بريد على هذا الحساب — تواصل معنا لتغيير كلمة المرور" };

  const throttled = await guardAuthAttempt("password-change", user.id, { perIp: [10, 900], perTarget: [5, 900] });
  if (throttled) return { error: throttled };

  // Supabase will change the password for anyone holding the session. That is one stolen laptop away
  // from a locked-out owner, so the current password is proved first — the check the session alone
  // cannot make.
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
  if (reauthError) return { error: "كلمة المرور الحالية غير صحيحة", field: "current_password" };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: translateAuthError(error.message), field: "new_password" };

  // Proving the old password opened a NEW session, and the second-factor proof (0069) is keyed to
  // the old one — so the next page this user opens will ask for their code again. Said out loud
  // because a verification screen straight after a password change reads as a fault.
  return { ok: "غُيّرت كلمة المرور. قد يُطلب منك رمز التحقّق مرّة أخرى عند الصفحة التالية." };
}
