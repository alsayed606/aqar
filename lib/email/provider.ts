// The single email-provider boundary. All system email (auth emails go through Supabase's Resend
// SMTP; app notifications go through here) is sent via Resend. Swapping to SES/another provider later
// is confined to THIS file — nothing else imports a provider SDK or knows the transport.

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendEmailResult =
  | { ok: true; id: string; raw: unknown }
  | { ok: false; error: string; raw?: unknown };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

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
        from,
        to: [input.to],
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
