/**
 * Turns the archive guard's refusal (migration 0067) into a sentence the office can act on.
 *
 * The guard raises a structured message — `HAS_DEPENDENTS:units=3;contracts=2` — precisely so this
 * layer can say "٣ وحدات وعقدان مرتبطان" instead of "لا يمكن الحذف". A refusal that does not name
 * what is in the way is the same silence the guard was written to end; it just moves it one step.
 */

/** Arabic counts: the dual and the 3–10 plural are different words, not an "s". */
function arabicCount(count: number, one: string, two: string, few: string): string {
  if (count === 1) return one;
  if (count === 2) return two;
  return `${count} ${few}`;
}

const UNITS = (n: number) => arabicCount(n, "وحدة واحدة", "وحدتان", "وحدات");
const CONTRACTS = (n: number) => arabicCount(n, "عقد واحد", "عقدان", "عقود");
const PROPERTIES = (n: number) => arabicCount(n, "عقار واحد", "عقاران", "عقارات");

function dependents(message: string): string[] {
  const payload = message.split("HAS_DEPENDENTS:")[1] ?? "";
  const parts: string[] = [];
  for (const pair of payload.split(";")) {
    const [key, raw] = pair.split("=");
    const count = Number(String(raw ?? "").replace(/\D/g, ""));
    if (!count) continue;
    if (key?.trim() === "units") parts.push(UNITS(count));
    if (key?.trim() === "contracts") parts.push(CONTRACTS(count));
    if (key?.trim() === "properties") parts.push(PROPERTIES(count));
  }
  return parts;
}

export function archiveErrorAr(message: string): string {
  if (/SELF_OWNER_UNDELETABLE/.test(message)) {
    return "هذا هو المالك الذاتي لمنشأتك، ولا يُحذف — فهويّته الضريبية هي ما يظهر على فواتير عقاراتك المملوكة.";
  }
  if (/CONTRACT_ACTIVE_ARCHIVE/.test(message)) {
    return "العقد نشط ولا يُحذف. لإنهائه استخدم «الإنهاء المبكر» من ملاحق العقد — فهو يُلغي الاستحقاقات غير المدفوعة ويُعيد الوحدة شاغرة.";
  }
  if (/HAS_DEPENDENTS/.test(message)) {
    const parts = dependents(message);
    // The guard raises with counts, but a message that arrived without any is still a refusal —
    // reporting it as a generic block beats reporting it as success.
    if (parts.length === 0) return "لا يمكن الحذف: توجد سجلّات مرتبطة.";
    return `لا يمكن الحذف: مرتبط بـ${parts.join(" و")}. احذفها أو انقلها أولاً.`;
  }
  if (/permission denied|row-level security/i.test(message)) {
    return "الحذف غير متاح بصلاحيتك الحالية.";
  }
  return message;
}
