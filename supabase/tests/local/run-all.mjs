// Runs every suite in this directory, one at a time, and fails if any of them does.
//
// The suites are DISCOVERED, not listed. A hand-written list is a list somebody forgets to add to:
// before this file, `npm run verify` ran two of fifteen suites, and the other thirteen — including
// every guard written in the last week — existed only on the machine that wrote them.
//
// One at a time is not a style choice. Each DB suite boots its own PostgreSQL on a fixed port, and
// two at once collide; a crashed run also leaves a zombie holding the port, which is why a failure
// here is reported with its suite name rather than swallowed into a single red X.
import { readdirSync, readFileSync } from "node:fs";
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

// Two suites on the same port is a real defect and an invisible one: they run one at a time, so the
// second boots against a database the first left behind and fails with assertions that have nothing
// to do with the port. It happened the moment two branches added a suite in parallel — each picked
// "the next free number" from the list it could see. Cheaper to refuse than to debug.
const ports = new Map();
for (const suite of suites) {
  const match = readFileSync(path.join(HERE, suite), "utf8").match(/bootWithMigrations\((\d+)\)/);
  if (!match) continue;
  const port = match[1];
  if (ports.has(port)) {
    console.error(`Port ${port} is claimed by both ${ports.get(port)} and ${suite}. Give one of them its own.`);
    process.exit(1);
  }
  ports.set(port, suite);
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
