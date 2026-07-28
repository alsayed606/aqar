import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { normalizeSaudiPhone } from "@/lib/phone";

// Inline "quick add landlord" used by the LandlordPicker modal. Runs with the user's session, so RLS
// (manage_data) gates the write exactly like the full owners form. Returns the new owner for selection.
export async function POST(request: Request) {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return NextResponse.json({ error: "no active org" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, string>;
  const display_name = String(body.display_name ?? "").trim();
  if (!display_name) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  const legal_kind = body.legal_kind === "company" ? "company" : "individual";
  const national_id = String(body.national_id ?? "").trim() || null;
  const phoneRaw = String(body.phone ?? "").trim();
  let phone_e164: string | null = null;
  if (phoneRaw) {
    phone_e164 = normalizeSaudiPhone(phoneRaw);
    if (!phone_e164) return NextResponse.json({ error: "رقم جوال غير صالح" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: party, error: pErr } = await supabase
    .from("party")
    .insert({ org_id: activeOrg, display_name, legal_kind, national_id, phone_e164, phone_raw: phoneRaw || null, roles: ["owner"] })
    .select("id")
    .single();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  const { data: owner, error: oErr } = await supabase
    .from("owner")
    .insert({ org_id: activeOrg, party_id: party.id, is_self: false, owner_kind: legal_kind })
    .select("id")
    .single();
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 400 });

  return NextResponse.json({ id: owner.id, label: display_name, national_id });
}
