// Simple notification email body (plain text + minimal inline-styled HTML). No template engine —
// intentionally kept to plain strings for this sprint (no React Email / MJML).

export type NotificationEmailInput = {
  orgName: string;
  title: string;
  body: string | null;
  link: string; // absolute link into the app (e.g. …/app/notifications)
};

export function renderNotificationEmail(input: NotificationEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const { orgName, title, body, link } = input;
  const bodyLine = body ? `${body}\n\n` : "";

  const text = `${title}\n\n${bodyLine}افتح التطبيق: ${link}\n\n— عقار · ${orgName}`;

  const html = `<div dir="rtl" style="font-family:-apple-system,Segoe UI,Tahoma,Arial,sans-serif;background:#f5f5f5;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:16px;padding:24px;color:#171717">
    <h1 style="margin:0 0 4px;font-size:18px">${escapeHtml(title)}</h1>
    ${body ? `<p style="margin:8px 0 16px;font-size:14px;color:#404040;line-height:1.7">${escapeHtml(body)}</p>` : ""}
    <a href="${encodeURI(link)}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px">فتح التطبيق</a>
    <p style="margin:24px 0 0;font-size:12px;color:#a3a3a3">عقار · ${escapeHtml(orgName)}</p>
  </div>
</div>`;

  return { subject: `عقار — ${title}`, text, html };
}

/**
 * The sign-in code e-mail.
 *
 * Deliberately has NO link and NO button. Every other message from us leads somewhere; this one does
 * not, because a "confirm your sign-in" link is the exact shape of the phishing mail this code is
 * meant to survive. The reader's job is to copy six digits into a page they opened themselves.
 */
export function renderOtpEmail(input: { code: string; ttlMinutes: number }): {
  subject: string;
  text: string;
  html: string;
} {
  const { code, ttlMinutes } = input;
  const subject = `عقار — رمز الدخول ${code}`;

  const text = `رمز الدخول: ${code}

صالح لمدة ${ttlMinutes} دقائق، ولمرّة واحدة.

إن لم تكن أنت من طلبه، فأحدهم يعرف كلمة مرورك — غيّرها الآن.

— عقار`;

  const html = `<div dir="rtl" style="font-family:-apple-system,Segoe UI,Tahoma,Arial,sans-serif;background:#f5f5f5;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:16px;padding:24px;color:#171717">
    <h1 style="margin:0 0 12px;font-size:18px">رمز الدخول</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#404040;line-height:1.7">أدخل هذا الرمز في الصفحة التي فتحتها:</p>
    <p dir="ltr" style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:#0f766e">${escapeHtml(code)}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#525252">صالح لمدة ${ttlMinutes} دقائق، ولمرّة واحدة.</p>
    <p style="margin:16px 0 0;font-size:13px;color:#b45309">إن لم تكن أنت من طلبه، فأحدهم يعرف كلمة مرورك — غيّرها الآن.</p>
    <p style="margin:24px 0 0;font-size:12px;color:#a3a3a3">عقار</p>
  </div>
</div>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The portal invitation.
 *
 * It DOES carry a link, unlike the sign-in code above, because the link is the invitation — there is
 * nothing to copy and no page the reader could have opened themselves. What makes it survivable is
 * the other half of the design (0074): the link alone proves nothing. Whoever opens it must sign in
 * with the address this message was sent to, so a forwarded link is useless to the forwardee.
 *
 * The message says that plainly. A reader who knows the rule is a reader who notices when it breaks.
 */
export function renderPortalInviteEmail(input: { orgName: string; link: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const { orgName, link } = input;
  const subject = `عقار — دعوة للاطّلاع على ملفك لدى ${orgName}`;

  const text = `دعاك ${orgName} للاطّلاع على ملفك: عقدك ودفعاتك وطلبات الصيانة.

افتح الرابط: ${link}

سجّل الدخول بالبريد الذي وصلتك عليه هذه الرسالة — الدعوة لا تُقبل من بريد آخر.
والرابط صالح ٣٠ يوماً ولمرّة واحدة.

إن لم تكن تتوقّع هذه الرسالة، تجاهلها ولا تفتح الرابط.

— عقار · ${orgName}`;

  const html = `<div dir="rtl" style="font-family:-apple-system,Segoe UI,Tahoma,Arial,sans-serif;background:#f5f5f5;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:16px;padding:24px;color:#171717">
    <h1 style="margin:0 0 4px;font-size:18px">دعوة للاطّلاع على ملفك</h1>
    <p style="margin:8px 0 16px;font-size:14px;color:#404040;line-height:1.7">دعاك <b>${escapeHtml(orgName)}</b> للاطّلاع على عقدك ودفعاتك وطلبات الصيانة.</p>
    <a href="${encodeURI(link)}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px">فتح الدعوة</a>
    <p style="margin:20px 0 0;font-size:13px;color:#525252;line-height:1.7">سجّل الدخول بالبريد الذي وصلتك عليه هذه الرسالة — <b>الدعوة لا تُقبل من بريد آخر</b>. والرابط صالح ٣٠ يوماً ولمرّة واحدة.</p>
    <p style="margin:12px 0 0;font-size:12px;color:#a3a3a3">إن لم تكن تتوقّع هذه الرسالة، تجاهلها ولا تفتح الرابط.</p>
    <p style="margin:24px 0 0;font-size:12px;color:#a3a3a3">عقار · ${escapeHtml(orgName)}</p>
  </div>
</div>`;

  return { subject, text, html };
}
