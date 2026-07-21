// Boots a throwaway PostgreSQL 17, applies every migration in ../../migrations, returns a client.
// Used by verify.mjs for a runnable, dependency-light check without needing pgTAP or Supabase.
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.resolve(HERE, '..', '..', 'migrations');

export async function bootWithMigrations(port = 54350) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pmsaas-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir, user: 'postgres', password: 'postgres', port,
    persistent: false,
    // libc + C locale avoids an ICU crash seen on some Windows builds.
    initdbFlags: ['--encoding=UTF8', '--locale-provider=libc', '--lc-collate=C', '--lc-ctype=C'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();

  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await client.query(readFileSync(path.join(MIG, f), 'utf8'));
    } catch (e) {
      await client.end().catch(() => {});
      await pg.stop().catch(() => {});
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
      throw new Error(`Migration ${f} failed: ${e.message}${e.position ? ' (pos ' + e.position + ')' : ''}`);
    }
  }
  const stop = async () => {
    await client.end().catch(() => {});
    await pg.stop().catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  };
  return { pg, client, files, stop };
}
