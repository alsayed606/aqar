// The single payment-gateway boundary. Moyasar hosted checkout via the Invoices API — the office
// pays on Moyasar's page, so card data NEVER touches our servers (PCI-safe). Swapping to Tap/another
// gateway later is confined to THIS file; nothing else knows the transport.

export type CreateInvoiceInput = {
  amountHalalas: number; // Moyasar amount is the smallest unit (halalas for SAR)
  description: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

export type CreateInvoiceResult =
  | { ok: true; id: string; url: string; raw: unknown }
  | { ok: false; error: string; raw?: unknown };

const MOYASAR_INVOICES = "https://api.moyasar.com/v1/invoices";

export async function createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const secret = process.env.MOYASAR_SECRET_KEY;
  if (!secret) return { ok: false, error: "payment gateway not configured (MOYASAR_SECRET_KEY)" };

  try {
    const res = await fetch(MOYASAR_INVOICES, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${secret}:`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountHalalas,
        currency: "SAR",
        description: input.description,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    const raw: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: `moyasar ${res.status}: ${JSON.stringify(raw)}`, raw };
    }
    const id = (raw as { id?: string })?.id;
    const url = (raw as { url?: string })?.url;
    if (!id || !url) return { ok: false, error: "moyasar: missing invoice id/url", raw };
    return { ok: true, id, url, raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Webhook authenticity: Moyasar includes the `secret_token` you configured on the webhook endpoint.
export function verifyWebhookSecret(secretToken: string | undefined | null): boolean {
  const expected = process.env.MOYASAR_WEBHOOK_SECRET;
  return !!expected && secretToken === expected;
}
