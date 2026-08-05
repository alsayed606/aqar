import { createClient } from "@/lib/supabase/server";
import { EXPECTED_MIGRATIONS } from "@/lib/migrations";

/**
 * Is this database complete for the code that is running against it?
 *
 * Two lists, compared. `EXPECTED_MIGRATIONS` is generated from the migrations directory at build
 * time — what this build of the app assumes exists. `app.schema_migration` is what the database
 * says it has. Neither alone answers the question; the difference does.
 *
 * That difference is what nobody could see when the tenant portal was dead for months: every
 * function 0029 defines was absent, the dashboard swallowed the error, and the only symptom was a
 * feature that quietly did nothing.
 */

export type MigrationRow = {
  version: string;
  name: string;
  applied_at: string;
  backfilled: boolean;
  verified: boolean;
};

export type MigrationHealth = {
  /** The ledger does not exist yet — 0068 has not been applied. */
  ledgerMissing: boolean;
  /** Present in the code's expectations, absent from the database. The list that matters. */
  missing: { version: string; name: string }[];
  /** In the database but not in this build — the app was rolled back, or the deploy is behind. */
  extra: MigrationRow[];
  /** Applied, but recorded without proof (a migration that only replaced function bodies). */
  unverified: MigrationRow[];
  expectedCount: number;
  appliedCount: number;
  error?: string;
};

export async function checkMigrations(): Promise<MigrationHealth> {
  const base: MigrationHealth = {
    ledgerMissing: false,
    missing: [],
    extra: [],
    unverified: [],
    expectedCount: EXPECTED_MIGRATIONS.length,
    appliedCount: 0,
  };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("migration_status");

  if (error) {
    // The ledger's own migration is the one case where "not found" is the answer, not a failure.
    if (/migration_status|PGRST202|schema cache/i.test(error.message)) {
      return { ...base, ledgerMissing: true, missing: EXPECTED_MIGRATIONS };
    }
    return { ...base, error: error.message };
  }

  const applied = (data ?? []) as MigrationRow[];
  const appliedByVersion = new Map(applied.map((m) => [m.version, m]));
  const expectedVersions = new Set(EXPECTED_MIGRATIONS.map((m) => m.version));

  return {
    ...base,
    appliedCount: applied.length,
    missing: EXPECTED_MIGRATIONS.filter((m) => !appliedByVersion.has(m.version)),
    extra: applied.filter((m) => !expectedVersions.has(m.version)),
    unverified: applied.filter((m) => !m.verified),
  };
}
