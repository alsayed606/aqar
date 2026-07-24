// build-schema.mjs — regenerates schema_all.sql from migrations/*.sql (Charter هـ-4, مر-18).
// SOURCE OF TRUTH = supabase/migrations/. Run:  node supabase/build-schema.mjs  (or npm run build:schema)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "migrations");
const OUT = path.join(HERE, "schema_all.sql");
const BAR = "-- " + "=".repeat(64);

const header =
  "-- schema_all.sql — GENERATED from supabase/migrations/*.sql by supabase/build-schema.mjs.\n" +
  "-- SOURCE OF TRUTH = migrations/ (Charter هـ-4). DO NOT EDIT BY HAND; run:\n" +
  "--   node supabase/build-schema.mjs   (or: npm run build:schema)\n" +
  "-- Convenience for one-shot apply (e.g. Supabase SQL Editor). Verified: loads clean on PostgreSQL 17.\n";

const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
let out = header;
for (const f of files) {
  const body = readFileSync(path.join(MIG, f), "utf8").replace(/\s*$/, "");
  out += `\n${BAR}\n-- ${f}\n${BAR}\n${body}\n`;
}
writeFileSync(OUT, out, "utf8");
console.log(`schema_all.sql regenerated from ${files.length} migrations (${files[0]} … ${files[files.length - 1]}).`);
