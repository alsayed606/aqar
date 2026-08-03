// Reports physical-direction Tailwind utilities that should be logical ones (§8 of the design
// system, adopted 2026-08-03). Zero dependencies — Aqar keeps a 7-package runtime.
//
// Why a script and not a lint rule: adding ESLint to this project means a new toolchain and a new
// dependency tree for one rule. This runs on plain Node and answers the same question.
//
// The distinction that makes the output worth reading: `text-right` beside `dir="ltr"` is CORRECT.
// A meter number, an IBAN or a date is a left-to-right run inside an Arabic page, and aligning it
// right aligns it to its own end. Flagging those would bury the real drift under false alarms, so
// a tag carrying an explicit `dir` is left alone for alignment classes.
//
//   node scripts/check-rtl.mjs            # whole app
//   node scripts/check-rtl.mjs path ...   # only these files

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Margins and padding are never direction-aware on their own — these are always drift.
const SPACING = /\b(?<cls>[a-z-]*:)?(?<prop>ml|mr|pl|pr)-(?<size>[0-9.]+|px|auto)\b/g;
// Alignment and insets are drift only when nothing declares the direction they belong to.
const ALIGNMENT = /\btext-(right|left)\b|\b(left|right)-(?:[0-9.]+|px|full|auto)\b|\bborder-(l|r)\b/g;

// The document is dir="rtl" (app/layout.tsx), so the physical RIGHT side is the logical START and
// LEFT is the END — the opposite of the mapping an LTR codebase would use. Getting this backwards
// would mirror every element the "fix" was applied to.
const LOGICAL = { mr: "ms", ml: "me", pr: "ps", pl: "pe" };

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// Splits the file into JSX opening tags so "does this element declare a direction?" can be asked of
// the element the class actually sits on, rather than of the whole line.
//
// Scanned rather than matched with a regex because Tailwind arbitrary variants put ">" inside the
// class string — `[&>th]:text-right` — and `<[^<>]*>` truncates the tag there, silently skipping
// every class after it. Quote state is tracked so the closing ">" is the real one.
function tagsOf(source) {
  const tags = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "<" || !/[a-zA-Z]/.test(source[i + 1] ?? "")) continue;
    let quote = null;
    for (let j = i + 1; j < source.length; j++) {
      const ch = source[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "<") {
        break; // not a tag after all — bail rather than swallow the rest of the file
      } else if (ch === ">") {
        tags.push({ text: source.slice(i, j + 1), index: i });
        i = j;
        break;
      }
    }
  }
  return tags;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function findingsIn(file) {
  const source = readFileSync(file, "utf8");
  const findings = [];

  for (const tag of tagsOf(source)) {
    const declaresDirection = /\bdir=/.test(tag.text);

    for (const m of tag.text.matchAll(SPACING)) {
      const { prop, size } = m.groups;
      findings.push({
        line: lineOf(source, tag.index + m.index),
        found: m[0],
        fix: m[0].replace(`${prop}-${size}`, `${LOGICAL[prop]}-${size}`),
        why: "margin/padding never follow the writing direction",
      });
    }

    if (declaresDirection) continue;
    for (const m of tag.text.matchAll(ALIGNMENT)) {
      findings.push({
        line: lineOf(source, tag.index + m.index),
        found: m[0],
        // The document is dir="rtl" (app/layout.tsx), so RIGHT is the start side and LEFT is the
        // end. Mapping right→end would silently flip the layout of everything it "fixed".
        fix: m[0].startsWith("text-")
          ? (m[0] === "text-right" ? "text-start (or add dir= if the content is LTR)" : "text-end")
          : "the logical equivalent (start-/end-), or add dir= if the placement is deliberate",
        why: "no dir= on this element, so the side was chosen by hand",
      });
    }
  }
  return findings;
}

const targets = process.argv.slice(2);
const files = targets.length ? targets : [...sourceFiles("app"), ...sourceFiles("components")];

let total = 0;
for (const file of files) {
  const findings = findingsIn(file);
  if (!findings.length) continue;
  total += findings.length;
  console.log(`\n${file.replace(/\\/g, "/")}`);
  for (const f of findings) console.log(`  ${f.line}: ${f.found} → ${f.fix}   (${f.why})`);
}

console.log(
  total === 0
    ? `\nRTL: no physical-direction utilities in ${files.length} file(s).`
    : `\nRTL: ${total} physical-direction utilities in ${files.length} file(s) scanned.`,
);
// Reporting only: §9 adopted §8 as "applied as files are touched", not as a sweep, so a non-zero
// count is a worklist rather than a build failure.
process.exitCode = 0;
