// IBAN check digits (lib/iban.ts), used on the office's collection account in /app/settings.
//
// The database can only assert the SHAPE of a Saudi IBAN — SA plus 22 digits. Everything below is
// about the failure that shape check waves through: a correctly-shaped account number that belongs
// to nobody, because two digits were swapped while typing it.
//
// Runs on Node's native TypeScript stripping (Node 23+); no build step, no postgres.
import { isValidIban } from "../../../lib/iban.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

// Saudi IBANs whose check digits are correct (the first is the widely used SAMA example).
const SA = "SA0380000000608010167519";
const SA2 = "SA4420000001234567891234";

console.log("— Valid —");
ok("a Saudi IBAN passes", isValidIban(SA));
ok("a second Saudi IBAN passes", isValidIban(SA2));
ok("spaces as the bank prints them are ignored", isValidIban("SA03 8000 0000 6080 1016 7519"));
ok("lowercase is accepted", isValidIban("sa0380000000608010167519"));
ok("a foreign IBAN with letters in the account part passes", isValidIban("GB82WEST12345698765432"));

console.log("\n— The whole point: transposition —");
// 03 → 30 in the check digits, and one swap inside the account number. Both keep the length and the
// digits, so every shape check in the system says yes.
ok("swapped check digits fail", !isValidIban("SA3080000000608010167519"));
ok("two swapped digits inside the account fail", !isValidIban("SA0380000000680010167519"));
ok("one digit changed fails", !isValidIban("SA0380000000608010167518"));

console.log("\n— Malformed —");
ok("empty is rejected", !isValidIban(""));
ok("too short is rejected", !isValidIban("SA0380"));
ok("too long is rejected", !isValidIban("SA03800000006080101675190000000000000"));
ok("a missing country code is rejected", !isValidIban("0380000000608010167519"));
ok("letters where the check digits belong are rejected", !isValidIban("SAXX80000000608010167519"));
ok("punctuation is rejected rather than stripped", !isValidIban("SA03-8000-0000-6080-1016-7519"));
ok("Arabic-Indic digits are not silently accepted here", !isValidIban("SA٠٣80000000608010167519"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
