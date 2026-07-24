// Maps the migration 0036 subscription-guard errors to friendly Arabic with an upgrade hint.
// Returns null when the message is not a subscription error, so callers keep their own handling.
export function translateSubscriptionError(
  message: string | null | undefined,
): string | null {
  if (!message) return null;
  if (/PLAN_LIMIT_EXCEEDED/i.test(message)) {
    return "بلغت الحد الأقصى لعدد العناصر في خطتك الحالية. لإضافة المزيد، رقِّ خطتك من صفحة «الاشتراك والاستخدام».";
  }
  if (/SUBSCRIPTION_EXPIRED/i.test(message)) {
    return "انتهت فترة اشتراكك وتوقّف إنشاء عناصر جديدة. بياناتك محفوظة كما هي؛ فعّل اشتراكك من صفحة «الاشتراك والاستخدام» للمتابعة.";
  }
  return null;
}
