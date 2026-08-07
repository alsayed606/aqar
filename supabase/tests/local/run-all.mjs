// Runs every suite in this directory, one at a time, and fails if any of them does.
//
// The suites are DISCOVERED, not listed. A hand-written list is a list somebody forgets to add to:
// before this file, `npm run verify` ran two of fifteen suites, and the other thirteen — including
// every guard written in the last week — existed only on the machine that wrote them.
//
// One at a time is not a style choice. Each DB suite boots its own PostgreSQL on a fixed port, and
// two at once collide; a crashed run also leaves a zombie holding the port, which is why a failure
// here is reported with its suite name rather than swallowed into a single red X.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));

// _pgutil is the shared harness, not a suite. Everything else that ends .mjs/.mts is one.
const suites = readdirSync(HERE)
  .filter((f) => /\.(mjs|mts)$/.test(f))
  .filter((f) => f !== SELF && !f.startsWith("_"))
  .sort();

if (suites.length === 0) {
  console.error("No test suites found — did this file move?");
  process.exit(1);
}

console.log(`Running ${suites.length} suites, one at a time.\n`);

const failed = [];
for (const suite of suites) {
  console.log(`\n${"=".repeat(60)}\n${suite}\n${"=".repeat(60)}`);
  const run = spawnSync(process.execPath, [suite], { cwd: HERE, stdio: "inherit" });
  if (run.status !== 0) failed.push(suite);
}

console.log(`\n${"=".repeat(60)}`);
if (failed.length === 0) {
  console.log(`All ${suites.length} suites passed.`);
  process.exit(0);
}
console.log(`FAILED (${failed.length}/${suites.length}): ${failed.join(", ")}`);
process.exit(1);
