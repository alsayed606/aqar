import { NextResponse } from "next/server";

// Which deployment is serving right now.
//
// The browser holds the id that was baked into ITS bundle at build time (NEXT_PUBLIC_BUILD_ID, set
// in next.config.mjs from the same variable). When a deploy lands, this route — served by the NEW
// deployment — starts answering with a different id while an open tab still carries the old one.
// That difference is the whole signal.
//
// Why it is needed: Next detects the version skew on the next server action or navigation and does a
// hard reload to recover. Correct, but it happens mid-keystroke, and whatever the office had typed
// is gone. Telling them a moment earlier turns a lost form into a choice.
export const dynamic = "force-dynamic";

export function GET() {
  // Empty when the platform does not provide it (local dev, another host). The client treats an
  // empty value on either side as "cannot tell" and stays silent — a false alarm on this banner
  // costs more trust than the miss it prevents.
  const id = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "";
  return NextResponse.json({ id }, { headers: { "cache-control": "no-store" } });
}
