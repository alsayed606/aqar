import { NextResponse } from "next/server";
import { checkSupabase } from "@/lib/supabase/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkSupabase();
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
