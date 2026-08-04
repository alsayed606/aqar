"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";
import { parseOrgProfile, orgProfileErrorAr } from "@/lib/org-profile";
import { translateAuthError } from "@/lib/auth-errors";
import { guardAuthAttempt } from "@/lib/rate-limit";

const LOGO_BUCKET = "org-assets";
const LOGO_MAX_BYTES = 512 * 1024;

function done(result: { ok?: string; error?: string }): never {
  const query = result.error
    ? `error=${encodeURIComponent(result.error)}`
    : `ok=${encodeURIComponent(result.ok ?? "saved")}`;
  redirect(`/app/settings?${query}`);
}

// ── The organization's own profile ───────────────────────────────────────────────────────────────

export async function updateOrgProfile(formData: FormData) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const { values, error } = parseOrgProfile(formData);
  if (error) done({ error });

  const supabase = await createClient();
  const { data, error: writeError } = await supabase
    .from("organization")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", activeOrg)
    .select("id");

  if (writeError) done({ error: orgProfileErrorAr(writeError.message) });

  // A member who is not an admin passes the SELECT policy and fails the UPDATE one, and an UPDATE
  // that matches no row is not an error — it reports success having changed nothing. Asking for the
  // affected rows back is what turns that silence into a message.
  if (!data || data.length === 0) done({ error: "تعديل بيانات المنشأة متاح للمدراء فقط" });

  revalidatePath("/app/settings");
  revalidatePath("/app");
  done({ ok: "org" });
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

export async function uploadOrgLogo(formData: FormData) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) done({ error: "اختر ملف الشعار أولاً" });
  if (file.size > LOGO_MAX_BYTES) done({ error: "حجم الشعار يجب أن يكون أقل من ٥٠٠ كيلوبايت" });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = imageExtension(bytes);
  if (!ext) done({ error: "الشعار يجب أن يكون صورة PNG أو JPG أو WEBP" });

  const supabase = await createClient();
  const path = `${activeOrg}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: MIME_BY_EXT[ext], upsert: true });
  if (uploadError) {
    const ar = /row-level security|not authorized|Unauthorized/i.test(uploadError.message)
      ? "رفع الشعار متاح للمدراء فقط"
      : /Bucket not found/i.test(uploadError.message)
        ? "لم تُنشأ مساحة التخزين بعد — طبّق الهجرة 0066"
        : uploadError.message;
    done({ error: ar });
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
  if (linkError) done({ error: orgProfileErrorAr(linkError.message) });
  if (!data || data.length === 0) done({ error: "رفع الشعار متاح للمدراء فقط" });

  revalidatePath("/app/settings");
  done({ ok: "logo" });
}

export async function removeOrgLogo() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data: current } = await supabase.from("organization").select("logo_path").eq("id", activeOrg).maybeSingle();

  const { data, error } = await supabase
    .from("organization")
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq("id", activeOrg)
    .select("id");
  if (error) done({ error: orgProfileErrorAr(error.message) });
  if (!data || data.length === 0) done({ error: "حذف الشعار متاح للمدراء فقط" });

  // The row is cleared first on purpose: if the object delete fails the page stops showing a logo
  // it can no longer fetch, instead of keeping a link to a file that may or may not be gone.
  if (current?.logo_path) await supabase.storage.from(LOGO_BUCKET).remove([current.logo_path]);

  revalidatePath("/app/settings");
  done({ ok: "logo_removed" });
}

// ── The signed-in person ─────────────────────────────────────────────────────────────────────────

export async function updateMyProfile(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/settings");

  const full_name = String(formData.get("full_name") ?? "").trim() || null;
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  let phone_e164: string | null = null;
  if (phoneRaw) {
    phone_e164 = normalizeSaudiPhone(phoneRaw);
    if (!phone_e164) done({ error: "رقم جوال غير صالح (مثال: 05XXXXXXXX)" });
  }

  const { error } = await supabase
    .from("identity")
    .update({ full_name, phone_e164, phone_raw: phoneRaw || null, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    const ar = /identity_contact_present/.test(error.message)
      ? "لا يمكن ترك الجوال والبريد فارغين معاً"
      : /duplicate|unique/i.test(error.message)
        ? "هذا الجوال مسجّل لحساب آخر"
        : error.message;
    done({ error: ar });
  }

  revalidatePath("/app/settings");
  done({ ok: "profile" });
}

export async function changeEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) done({ error: "أدخل بريداً إلكترونياً صالحاً" });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/settings");
  if (user.email?.toLowerCase() === email) done({ error: "هذا هو بريدك الحالي" });

  // Changing the login address is an account-takeover step if it is ever done by someone else, so it
  // is throttled like a sign-in attempt.
  const throttled = await guardAuthAttempt("email-change", user.id, { perIp: [5, 3600], perTarget: [3, 3600] });
  if (throttled) done({ error: throttled });

  const { error } = await supabase.auth.updateUser({ email });
  if (error) done({ error: translateAuthError(error.message) });

  // The address does not change until the link is opened. app.identity follows automatically then,
  // through the auth.users trigger added in 0066.
  done({ ok: "email_pending" });
}

export async function changePassword(formData: FormData) {
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  if (next.length < 8) done({ error: "كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل" });
  if (next === current) done({ error: "كلمة المرور الجديدة مطابقة للحالية" });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/settings");
  if (!user.email) done({ error: "لا يوجد بريد على هذا الحساب — تواصل معنا لتغيير كلمة المرور" });

  const throttled = await guardAuthAttempt("password-change", user.id, { perIp: [10, 900], perTarget: [5, 900] });
  if (throttled) done({ error: throttled });

  // Supabase will change the password for anyone holding the session. That is one stolen laptop away
  // from a locked-out owner, so the current password is proved first — the check the session alone
  // cannot make.
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
  if (reauthError) done({ error: "كلمة المرور الحالية غير صحيحة" });

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) done({ error: translateAuthError(error.message) });

  done({ ok: "password" });
}
