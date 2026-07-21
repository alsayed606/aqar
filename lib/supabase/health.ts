import { createClient } from "./server";

export type HealthReport = {
  ok: boolean;
  supabaseUrl: string;
  checks: {
    envConfigured: boolean;
    restReachable: boolean;
    appSchemaExposed: boolean;
    note?: string;
    error?: string;
  };
};

/**
 * Live connectivity probe used by the landing page and /api/health.
 * Interprets PostgREST responses so the report tells you exactly what (if anything) to fix:
 *   - PGRST106 / "schema must be one of" → the `app` schema is not exposed in the API settings.
 *   - 42501 / "permission denied"        → reachable + schema exposed; anon is correctly blocked by
 *                                          grants/RLS. This is the EXPECTED healthy state for anon.
 *   - no error (empty rows)              → reachable, exposed, and RLS returned nothing (also healthy).
 */
export async function checkSupabase(): Promise<HealthReport> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const envConfigured =
    !!supabaseUrl && !!anonKey && !anonKey.includes("REPLACE");

  const report: HealthReport = {
    ok: false,
    supabaseUrl,
    checks: { envConfigured, restReachable: false, appSchemaExposed: false },
  };

  if (!envConfigured) {
    report.checks.error =
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (anon key is still a placeholder).";
    return report;
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("organization").select("id").limit(1);

    if (!error) {
      report.checks.restReachable = true;
      report.checks.appSchemaExposed = true;
      report.ok = true;
      report.checks.note = "Connected. RLS returned no rows for the anonymous role (expected).";
      return report;
    }

    const code = error.code ?? "";
    const msg = error.message ?? "";
    report.checks.restReachable = true;

    if (code === "PGRST106" || /schema must be one of/i.test(msg)) {
      report.checks.appSchemaExposed = false;
      report.checks.error =
        "The 'app' schema is not exposed. Supabase → Project Settings → API → Exposed schemas → add 'app'.";
    } else if (code === "42501" || /permission denied/i.test(msg)) {
      report.checks.appSchemaExposed = true;
      report.ok = true;
      report.checks.note =
        "Connected. Anonymous role is blocked by grants/RLS as designed — sign-in required for data.";
    } else {
      report.checks.appSchemaExposed = true;
      report.checks.error = `${code} ${msg}`.trim();
    }
  } catch (e) {
    report.checks.error = e instanceof Error ? e.message : String(e);
  }

  return report;
}
