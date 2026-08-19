// The single email-provider boundary. All system email (auth emails go through Supabase's Resend
// SMTP; app notifications go through here) is sent via Resend. Swapping to SES/another provider later
// is confined to THIS file — nothing else imports a provider SDK or knows the transport.

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Friendly name to show instead of the one baked into EMAIL_FROM. The address never changes — only
   * a verified sending domain can be used — so this affects who the message *says* it is from, not
   * where it is from. Used to put the office's own name in front of a tenant who has never heard of
   * the platform.
   */
  fromName?: string;
  /**
   * Where a reply should go. A transactional message nobody can answer is a dead end for the reader
   * and reads, to a spam filter, like bulk mail.
   */
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string; raw: unknown }
  | { ok: false; error: string; raw?: unknown };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Rebuild the From header with a different display name, keeping the configured address.
 *
 * EMAIL_FROM is either a bare address or `Name <address>`. A name carrying `<`, `>` or a quote would
 * break the header, so those are dropped rather than escaped — a display name is decoration, and a
 * malformed header is a rejected message.
 */
function withFromName(from: string, name: string): string {
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  const clean = name.replace(/[<>"\r\n]/g, "").trim();
  return clean ? `${clean} <${address}>` : from;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: "email provider not configured (RESEND_API_KEY / EMAIL_FROM)" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: input.fromName ? withFromName(from, input.fromName) : from,
        to: [input.to],
        ...(input.replyTo ? { reply_to: [input.replyTo] } : {}),
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
    const raw: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
      return { ok: false, error: `resend ${res.status}: ${detail}`, raw };
    }
    const id = (raw as { id?: string })?.id ?? "";
    return { ok: true, id, raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
