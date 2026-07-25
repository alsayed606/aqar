// Maps Supabase Auth (GoTrue) error messages to friendly Arabic. Falls back to the raw message.
export function translateAuthError(message: string | null | undefined): string {
  const m = message ?? "";
  if (/invalid login credentials/i.test(m)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  if (/already registered|already.*exists|user already/i.test(m)) return "هذا البريد مسجّل مسبقاً. سجّل الدخول بدلاً من إنشاء حساب.";
  if (/password should be at least|weak password|at least 6|too short/i.test(m)) return "كلمة المرور قصيرة جداً (٨ أحرف على الأقل).";
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return "بريد إلكتروني غير صالح.";
  if (/email not confirmed/i.test(m)) return "لم يُفعّل الحساب بعد. افتح رابط التأكيد في بريدك ثم سجّل الدخول.";
  if (/rate limit|too many requests/i.test(m)) return "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.";
  if (/signups?.*disabled/i.test(m)) return "إنشاء الحسابات معطّل حالياً. تواصل مع مسؤول المنصّة.";
  return m || "تعذّر إتمام العملية. حاول مجدداً.";
}
