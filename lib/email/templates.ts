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

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
