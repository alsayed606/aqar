import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/return-to";

export const dynamic = "force-dynamic";

// Generic auth callback for EVERY Supabase Auth email flow — sign-up confirmation, password recovery,
// magic link, invite, and email change — via either the PKCE `code` param or the `token_hash`+`type`
// pair. It exchanges the credential for a session, then forwards to a validated internal `next`.
const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeReturnTo(url.searchParams.get("next")) ?? "/app";

  const supabase = await createClient();
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin));

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("انتهت صلاحية الرابط أو أنه غير صالح. أعد المحاولة.");
  } else if (tokenHash && type && OTP_TYPES.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    if (error) return fail("انتهت صلاحية الرابط أو أنه غير صالح. أعد المحاولة.");
  } else {
    return fail("رابط غير مكتمل.");
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
