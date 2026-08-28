// The gates on the money endpoints, exercised through a real running server.
//
// Four clean-code reviews in one week ended at the same sentence: the fix is in a server action or an
// HTTP route, and this project has no way to test either. The suites are embedded-Postgres SQL or
// pure `.mts` functions, so every app-layer fix shipped unverified. This is the first suite that
// boots the product and talks to it over HTTP.
//
// WHAT IT DELIBERATELY STOPS SHORT OF, and why:
//
// Everything below asserts a refusal that happens BEFORE any Supabase call. That is not a limitation
// of ambition; it is the only honest scope until a dedicated test project exists. `next start` loads
// .env.local, so a request that reaches the database would reach the REAL one — and a test suite that
// touches production data is worse than no test suite. Positive paths wait for a test Supabase
// project, which is the owner's decision to make.
//
// What is covered is not small: these are the doors on the two cron endpoints and the payment
// webhook. If one of them silently opened, nothing else in the product would notice.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;

// Passed in the child's environment, which Next gives precedence over .env.local — so these are the
// secrets the server under test actually enforces, whatever the developer's machine holds.
const CRON_SECRET = "e2e-cron-secret-not-a-real-one";
const WEBHOOK_SECRET = "e2e-webhook-secret-not-a-real-one";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

async function waitForServer(child) {
  // 60s: a cold `next start` on Windows is slow, and a flaky timeout would teach the team to
  // distrust the suite — which costs more than the wait.
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try {
      const res = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // Not up yet. The loop is the wait.
    }
    await sleep(500);
  }
  // Without the server's own output a failure here reads "did not become ready" and tells nobody
  // why — a missing build, a busy port, a bad env all look identical.
  throw new Error("server did not become ready:\n" + noise.join("").slice(-1500));
}

// Next's JS entry point run by node directly — not `npx`, and not the .bin shim. Node refuses to
// spawn a .cmd without a shell, and spawning through a shell on Windows concatenates arguments
// instead of escaping them. This has neither problem and is the same file on every platform.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  cwd: process.cwd(),
  env: { ...process.env, CRON_SECRET, MOYASAR_WEBHOOK_SECRET: WEBHOOK_SECRET },
  stdio: ["ignore", "pipe", "pipe"],
});
const noise = [];
const remember = (d) => {
  noise.push(String(d));
  if (process.env.E2E_VERBOSE) process.stderr.write(String(d));
};
server.stdout.on("data", remember);
server.stderr.on("data", remember);

try {
  await waitForServer(server);

  // ---------------- The cron endpoints ----------------
  // Both drain real work: one sends every queued e-mail and deletes erased people's photographs, the
  // other charges saved cards. An open door here is a stranger running the billing cycle.
  for (const job of ["drain-notifications", "renew-subscriptions"]) {
    const bare = await fetch(`${BASE}/api/cron/${job}`);
    ok(`${job} refuses a request with no Authorization header`, bare.status === 401, `got ${bare.status}`);

    const wrong = await fetch(`${BASE}/api/cron/${job}`, {
      headers: { Authorization: "Bearer definitely-not-the-secret" },
    });
    ok(`${job} refuses a wrong bearer token`, wrong.status === 401, `got ${wrong.status}`);

    // The prefix matters: verifyBearer requires "Bearer ", and a raw secret must not pass.
    const noPrefix = await fetch(`${BASE}/api/cron/${job}`, { headers: { Authorization: CRON_SECRET } });
    ok(`${job} refuses the secret without the Bearer prefix`, noPrefix.status === 401, `got ${noPrefix.status}`);
  }

  // ---------------- The payment webhook ----------------
  const badJson = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json at all",
  });
  ok("webhook refuses a body that is not JSON", badJson.status === 400, `got ${badJson.status}`);

  const noSecret = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "invoice_paid", data: { id: "inv_1", status: "paid" } }),
  });
  ok("webhook refuses a payload with no secret", noSecret.status === 401, `got ${noSecret.status}`);

  const wrongSecret = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_token: "wrong", data: { id: "inv_1", status: "paid" } }),
  });
  ok("webhook refuses a wrong secret", wrongSecret.status === 401, `got ${wrongSecret.status}`);

  // Authenticated, and still refused — for the right reason. This is the furthest the suite can go
  // without a database: the secret check has passed, and the route stops because the payload names
  // no intent. It proves the gate opens for the right caller AND that a malformed authentic message
  // is rejected rather than half-applied.
  const noIntent = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_token: WEBHOOK_SECRET, data: { id: "inv_1", status: "paid" } }),
  });
  ok(
    "webhook accepts the right secret and then refuses a payload with no payment_intent",
    noIntent.status === 400,
    `got ${noIntent.status}`,
  );

  // ---------------- The deployment probe ----------------
  // /api/version is what tells a reader whether the page they are looking at is the code they just
  // pushed. It cost this project real time when it was not consulted.
  //
  // The id is EMPTY here, and that is the contract, not a gap: it comes from VERCEL_GIT_COMMIT_SHA,
  // which only the platform sets, and the skew banner is written to stay silent rather than guess
  // when either side is blank. What matters is the shape — a JSON object with an `id` string — and
  // that the route is never cached, because a cached answer would report the deployment it was
  // cached under forever.
  const version = await fetch(`${BASE}/api/version`);
  const body = await version.json();
  ok("version answers with an id field", version.ok && typeof body.id === "string", JSON.stringify(body));
  ok(
    "version is never cached",
    (version.headers.get("cache-control") ?? "").includes("no-store"),
    version.headers.get("cache-control") ?? "(none)",
  );
} catch (e) {
  fail++;
  console.log("  FAIL  suite aborted -> " + (e?.message ?? e));
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  // Stop reading the pipes before killing: exiting the process while libuv is still closing a
  // child's stream handles trips an assertion on Windows, and a suite that reports 12/12 and then
  // crashes teaches everyone to ignore its exit code.
  server.stdout.removeAllListeners("data");
  server.stderr.removeAllListeners("data");
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  // `next start` runs its own worker; if the polite signal does not reach it, insist.
  const forced = setTimeout(() => server.kill("SIGKILL"), 3000);
  await Promise.race([stopped, sleep(6000)]);
  clearTimeout(forced);
  process.exitCode = fail ? 1 : 0;
}
