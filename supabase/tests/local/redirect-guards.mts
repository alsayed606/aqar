// Guards on every "send the user back here afterwards" path in the app.
//
// safeReturnTo is the only thing standing between an attacker-supplied string and redirect(), and
// it protects the login flow, the platform console, unit editing and — through safeBack — the whole
// utilities module. It had no tests at all until this file.
//
// Runs on Node's native TypeScript stripping (Node 23+); no build step, no postgres.
import { safeReturnTo } from "../../../lib/return-to.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

// ==================== What must be allowed ====================
ok("a plain in-app path is returned unchanged", safeReturnTo("/app/units") === "/app/units");
ok("a path with a query string survives",
  safeReturnTo("/app/utilities/readings?meter=1&review=1") === "/app/utilities/readings?meter=1&review=1");
ok("a path with a fragment survives", safeReturnTo("/app/units#top") === "/app/units#top");

// ==================== Off-site ====================
ok("an absolute URL is refused", safeReturnTo("https://evil.example/steal") === null);
ok("a protocol-relative URL is refused", safeReturnTo("//evil.example/steal") === null);
// Browsers normalise "\" to "/", so "/\evil.example" reaches the network as "//evil.example".
ok("the backslash form of a protocol-relative URL is refused", safeReturnTo("/\\evil.example") === null);
ok("a scheme with no slashes is refused", safeReturnTo("javascript:alert(1)") === null);
ok("a bare host is refused", safeReturnTo("evil.example") === null);

// ==================== Header smuggling ====================
// Written as escape sequences rather than literal bytes: a raw control character in source can be
// silently dropped by an editor, and the assertion would then pass while testing nothing.
ok("a CR/LF pair is refused", safeReturnTo("/app\r\nLocation: https://evil.example") === null);
ok("a bare newline is refused", safeReturnTo("/app\nX") === null);
ok("a tab is refused", safeReturnTo("/app\tX") === null);
ok("a NUL is refused", safeReturnTo("/app\u0000X") === null);
ok("a DEL is refused", safeReturnTo("/app\u007fX") === null);
ok("a leading space is refused", safeReturnTo(" /app") === null);
ok("an embedded space is refused", safeReturnTo("/app units") === null);

// ==================== Empty, absent, oversized ====================
ok("an empty string yields null so the caller falls back", safeReturnTo("") === null);
ok("null yields null", safeReturnTo(null) === null);
ok("undefined yields null", safeReturnTo(undefined) === null);
ok("an over-long path is refused", safeReturnTo("/app/" + "a".repeat(1100)) === null);
ok("a path just under the limit is allowed", safeReturnTo("/a" + "b".repeat(1021))?.length === 1023);

// ==================== The login bounce ====================
ok("/login is refused so a redirect cannot loop back to it", safeReturnTo("/login") === null);
ok("/login with a query is refused too", safeReturnTo("/login?returnTo=/app") === null);

// ==================== The prefix test the utilities module layers on top ====================
// safeBack in app/app/utilities/actions.ts keeps only paths inside its own module. That narrowing
// is meaningless unless safeReturnTo has already removed everything that merely LOOKS like a path,
// so these two assertions pin the contract the narrowing depends on.
const inModule = safeReturnTo("/app/utilities/bills?status=overdue");
ok("a utilities path passes the shared guard before the prefix test sees it",
  inModule !== null && inModule.startsWith("/app/utilities"));
ok("a value that only looks like the module path is already gone",
  safeReturnTo("//app/utilities") === null);

console.log(`\nRedirect guards: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
