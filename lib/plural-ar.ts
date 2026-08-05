/**
 * Counted nouns in Arabic. Four forms, not two.
 *
 *   1        عقد واحد          — the noun alone; the numeral is not said
 *   2        عقدان             — a dual form, a different word
 *   3–10     ٣ عقود            — the numeral, then the plural
 *   11+      ١٢ عقداً           — the numeral, then the SINGULAR again (تمييز)
 *
 * The trap is the last one, because it looks like a regression to whoever wrote the plural: "١٢
 * عقود" is what an English-shaped `n === 1 ? x : xs` produces, and it is wrong. This has now been
 * got wrong twice in this codebase — once as "1 بنداً" on a timeline, once as "12 دفعات" in the
 * contract summary — which is why the rule lives in one place instead of at each call site.
 */
/**
 * ⚠️ The dual here is the NOMINATIVE one ("عقدان"). After a preposition or a transitive verb Arabic
 * wants the genitive/accusative dual instead ("عقدين"), and no single string can be both. So the
 * call site owns the frame: phrase it so the count is a subject — "عليه عقدان", "له عقاران",
 * "ستُنشأ دفعتان" — never "مرتبط بـ…" or "يملك …" directly in front of this.
 */
export type ArabicNoun = {
  /** 1 — usually "<noun> واحد/واحدة". */
  one: string;
  /** 2 — the dual, e.g. "عقدان". */
  two: string;
  /** 3–10 — the plural, e.g. "عقود". */
  few: string;
  /** 11 and above — the singular in the accusative, e.g. "عقداً". */
  many: string;
};

export function countAr(count: number, noun: ArabicNoun): string {
  const n = Math.abs(Math.trunc(count));
  if (n === 1) return noun.one;
  if (n === 2) return noun.two;
  if (n >= 3 && n <= 10) return `${n} ${noun.few}`;
  return `${n} ${noun.many}`;
}

export const CONTRACT_AR: ArabicNoun = { one: "عقد واحد", two: "عقدان", few: "عقود", many: "عقداً" };
export const UNIT_AR: ArabicNoun = { one: "وحدة واحدة", two: "وحدتان", few: "وحدات", many: "وحدة" };
export const PROPERTY_AR: ArabicNoun = { one: "عقار واحد", two: "عقاران", few: "عقارات", many: "عقاراً" };
export const INSTALMENT_AR: ArabicNoun = { one: "دفعة واحدة", two: "دفعتان", few: "دفعات", many: "دفعة" };
