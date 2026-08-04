// CSV export correctness. Every assertion here is about what Excel does with the bytes, because
// Excel is where these files are opened.
//
// Runs on Node's native TypeScript stripping (Node 23+); no build step, no postgres.
import { toCsv } from "../../../lib/csv.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const BOM = "\uFEFF";
const col = (header: string) => ({ header, value: (r: any) => r[header] });

// ==================== The BOM ====================
const simple = toCsv([{ a: "قيمة" }], [col("a")]);
ok("output starts with a UTF-8 BOM", simple.startsWith(BOM),
  JSON.stringify(simple.slice(0, 3)));
ok("Arabic survives unescaped", simple.includes("قيمة"));

// ==================== Line endings ====================
ok("rows are separated by CRLF", toCsv([{ a: "1" }, { a: "2" }], [col("a")]).includes("1\r\n2"));
ok("the file ends with a newline", simple.endsWith("\r\n"));

// ==================== Escaping ====================
ok("a comma forces quoting",
  toCsv([{ a: "الرياض, حي النخيل" }], [col("a")]).includes('"الرياض, حي النخيل"'));
ok("an inner double quote is doubled",
  toCsv([{ a: 'قال "نعم"' }], [col("a")]).includes('"قال ""نعم"""'));
ok("a newline inside a value is quoted, not left to split the row",
  toCsv([{ a: "سطر\nآخر" }], [col("a")]).includes('"سطر\nآخر"'));

// ==================== Empty and absent ====================
ok("null becomes an empty field", toCsv([{ a: null }], [col("a")]).endsWith("a\r\n\r\n"));
ok("undefined becomes an empty field", toCsv([{ a: undefined }], [col("a")]).endsWith("a\r\n\r\n"));
ok("zero is written, not treated as empty", toCsv([{ a: 0 }], [col("a")]).includes("\r\n0\r\n"));
ok("no rows still yields the header", toCsv([], [col("a")]) === BOM + "a\r\n");

// ==================== Formula injection ====================
// A tenant is free to be named "=cmd|…". Excel executes a leading =, +, - or @ on open, so the
// value has to reach the cell as text. The single quote is Excel's literal-text marker and is not
// displayed.
for (const trigger of ["=", "+", "-", "@"]) {
  const out = toCsv([{ a: `${trigger}HYPERLINK("http://x")` }], [col("a")]);
  ok(`a value starting with "${trigger}" is neutralised`, out.includes(`'${trigger}HYPERLINK`),
    JSON.stringify(out));
}
ok("a tab-led value is neutralised too", toCsv([{ a: "\tx" }], [col("a")]).includes("'\tx"));
ok("an ordinary value is NOT prefixed", toCsv([{ a: "محمد" }], [col("a")]).includes("\r\nمحمد"));
// A negative number reads as a formula trigger to Excel as well; correctness beats prettiness here.
ok("a negative number is neutralised rather than left executable",
  toCsv([{ a: "-500" }], [col("a")]).includes("'-500"));

// ==================== Header row ====================
const multi = toCsv([{ a: "1", b: "2" }], [col("a"), col("b")]);
ok("headers appear in the given order", multi.startsWith(BOM + "a,b\r\n"), JSON.stringify(multi));
ok("values follow the same column order", multi.includes("\r\n1,2"));

console.log(`\nCSV: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
