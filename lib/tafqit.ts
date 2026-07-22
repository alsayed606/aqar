// تفقيط: convert an amount to Arabic words for a receipt/invoice ("المبلغ كتابةً").
// Handles 0 .. 999,999,999,999. Grammar is the common accounting form (gender-neutral counted noun);
// good enough for a printed سند قبض. Input is integer halalas (1 ﷼ = 100 هللة).

const ONES = [
  "", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة",
  "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر",
  "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر",
];

const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];

const HUNDREDS = [
  "", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة",
  "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة",
];

// [singular, dual, plural] per scale. Units scale has no word.
const SCALES: Array<[string, string, string] | null> = [
  null,
  ["ألف", "ألفان", "آلاف"],
  ["مليون", "مليونان", "ملايين"],
  ["مليار", "ملياران", "مليارات"],
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${ONES[u]} و ${TENS[t]}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h]);
  if (rem > 0) parts.push(twoDigits(rem));
  return parts.join(" و ");
}

/** A non-negative integer → Arabic words. */
export function numberToArabicWords(num: number): string {
  if (!Number.isFinite(num) || num < 0) return "";
  let n = Math.floor(num);
  if (n === 0) return "صفر";

  // Split into 3-digit groups, least significant first.
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }

  const out: string[] = [];
  for (let s = groups.length - 1; s >= 0; s--) {
    const g = groups[s];
    if (g === 0) continue;
    const scale = SCALES[s];
    if (!scale) {
      out.push(threeDigits(g));
    } else if (g === 1) {
      out.push(scale[0]); // ألف / مليون / مليار — no "واحد"
    } else if (g === 2) {
      out.push(scale[1]); // ألفان / مليونان / ملياران — no "اثنان"
    } else if (g <= 10) {
      out.push(`${threeDigits(g)} ${scale[2]}`); // ثلاثة آلاف
    } else {
      out.push(`${threeDigits(g)} ${scale[0]}`); // أحد عشر ألفاً
    }
  }
  return out.join(" و ");
}

/**
 * Integer halalas → a full receipt phrase, e.g.
 *   285000000 → "فقط مليونان وثمانمائة وخمسون ألف ريال سعودي لا غير"
 *   285050    → "فقط ألفان وثمانمائة وخمسون ريالاً وخمسون هللة سعودية لا غير"
 */
export function tafqitSar(halalas: number | string | null | undefined): string {
  const total = Math.round(Number(halalas ?? 0));
  if (!Number.isFinite(total) || total <= 0) return "—";
  const riyals = Math.floor(total / 100);
  const hal = total % 100;

  const parts: string[] = [];
  if (riyals > 0) parts.push(`${numberToArabicWords(riyals)} ريالاً سعودياً`);
  if (hal > 0) parts.push(`${numberToArabicWords(hal)} هللة`);

  return `فقط ${parts.join(" و ")} لا غير`;
}
