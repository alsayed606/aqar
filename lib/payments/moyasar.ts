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

// Off-session recurring charge against a saved card token (Payments API). status 'paid' = success.
export type ChargeTokenInput = {
  token: string;
  amountHalalas: number;
  description: string;
  metadata: Record<string, string>;
};
export type ChargeTokenResult =
  | { ok: true; id: string; status: string; raw: unknown }
  | { ok: false; error: string; raw?: unknown };

const MOYASAR_PAYMENTS = "https://api.moyasar.com/v1/payments";

export async function chargeToken(input: ChargeTokenInput): Promise<ChargeTokenResult> {
  const secret = process.env.MOYASAR_SECRET_KEY;
  if (!secret) return { ok: false, error: "payment gateway not configured (MOYASAR_SECRET_KEY)" };

  try {
    const res = await fetch(MOYASAR_PAYMENTS, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${secret}:`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountHalalas,
        currency: "SAR",
        description: input.description,
        source: { type: "token", token: input.token },
        metadata: input.metadata,
      }),
    });
    const raw: unknown = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `moyasar ${res.status}: ${JSON.stringify(raw)}`, raw };
    const id = (raw as { id?: string })?.id ?? "";
    const status = (raw as { status?: string })?.status ?? "";
    return { ok: true, id, status, raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Extract a reusable card token (+ display brand/last4) from a Moyasar payment payload, when present.
export function extractCardToken(
  data: Record<string, unknown>,
): { token: string; brand: string | null; last4: string | null } | null {
  const source = (data.source ?? {}) as Record<string, unknown>;
  const token = (source.token as string) || "";
  if (!token) return null;
  const brand = (source.company as string) ?? null;
  const number = (source.number as string) ?? "";
  const last4 = number ? number.replace(/\D/g, "").slice(-4) : null;
  return { token, brand, last4 };
}
