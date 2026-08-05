// Arabic counted nouns (lib/plural-ar.ts).
//
// This exists because the same mistake has now shipped twice: "1 بنداً" on a timeline, and
// "12 دفعات" in the contract summary. Both came from an English-shaped `n === 1 ? x : xs`, which
// has no idea that Arabic changes the noun again at eleven.
//
// Runs on Node's native TypeScript stripping (Node 23+); no build step, no postgres.
import { countAr, CONTRACT_AR, UNIT_AR, PROPERTY_AR, INSTALMENT_AR } from "../../../lib/plural-ar.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};
const eq = (name: string, got: string, want: string) => ok(`${name} → ${want}`, got === want, `got "${got}"`);

console.log("— The four forms —");
eq("1 عقد", countAr(1, CONTRACT_AR), "عقد واحد");
eq("2 عقد", countAr(2, CONTRACT_AR), "عقدان");
eq("3 عقد", countAr(3, CONTRACT_AR), "3 عقود");
eq("10 عقد", countAr(10, CONTRACT_AR), "10 عقود");

console.log("\n— Eleven, where it went wrong before —");
eq("11 عقد", countAr(11, CONTRACT_AR), "11 عقداً");
eq("12 دفعة", countAr(12, INSTALMENT_AR), "12 دفعة");
eq("99 وحدة", countAr(99, UNIT_AR), "99 وحدة");
eq("100 عقار", countAr(100, PROPERTY_AR), "100 عقاراً");
// The single assertion this file is really for: eleven must NOT reuse the 3–10 plural.
ok("11 never takes the 3–10 plural", !countAr(11, CONTRACT_AR).includes("عقود"), countAr(11, CONTRACT_AR));
ok("12 never takes the 3–10 plural", !countAr(12, INSTALMENT_AR).includes("دفعات"), countAr(12, INSTALMENT_AR));

console.log("\n— Boundaries —");
eq("the last 'few'", countAr(10, UNIT_AR), "10 وحدات");
eq("the first 'many'", countAr(11, UNIT_AR), "11 وحدة");
// Zero is not a count anyone displays through this, but it must not crash or claim "one".
ok("0 does not read as one", countAr(0, CONTRACT_AR) !== CONTRACT_AR.one, countAr(0, CONTRACT_AR));
eq("a negative is read by magnitude", countAr(-2, CONTRACT_AR), "عقدان");
eq("a fraction is truncated", countAr(2.9, CONTRACT_AR), "عقدان");

console.log("\n— The dual is the nominative one —");
// Every table entry must carry the nominative dual; call sites are written to put the count in a
// subject position. A table that shipped "عقدين" here would read wrong in every one of them.
for (const [label, noun] of [["عقد", CONTRACT_AR], ["وحدة", UNIT_AR], ["عقار", PROPERTY_AR], ["دفعة", INSTALMENT_AR]] as const) {
  ok(`${label}: dual is nominative (…ان)`, noun.two.endsWith("ان"), noun.two);
  ok(`${label}: 'one' says واحد/واحدة`, /واحد/.test(noun.one), noun.one);
}

console.log(`\nArabic plurals: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
