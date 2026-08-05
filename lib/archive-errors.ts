/**
 * Turns the archive guard's refusal (migration 0067) into a sentence the office can act on.
 *
 * The guard raises a structured message — `HAS_DEPENDENTS:units=3;contracts=2` — precisely so this
 * layer can say "٣ وحدات وعقدان مرتبطان" instead of "لا يمكن الحذف". A refusal that does not name
 * what is in the way is the same silence the guard was written to end; it just moves it one step.
 */
import { countAr, CONTRACT_AR, PROPERTY_AR, UNIT_AR } from "@/lib/plural-ar";

function dependents(message: string): string[] {
  const payload = message.split("HAS_DEPENDENTS:")[1] ?? "";
  const parts: string[] = [];
  for (const pair of payload.split(";")) {
    const [key, raw] = pair.split("=");
    const count = Number(String(raw ?? "").replace(/\D/g, ""));
    if (!count) continue;
    if (key?.trim() === "units") parts.push(countAr(count, UNIT_AR));
    if (key?.trim() === "contracts") parts.push(countAr(count, CONTRACT_AR));
    if (key?.trim() === "properties") parts.push(countAr(count, PROPERTY_AR));
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
    // "مرتبط بـ…" would put the count after a preposition, where the Arabic dual changes form.
    // Naming the dependants as the subject keeps every count in the nominative.
    return `لا يمكن الحذف: ${parts.join(" و")} مرتبطة به. احذفها أو انقلها أولاً.`;
  }
  if (/permission denied|row-level security/i.test(message)) {
    return "الحذف غير متاح بصلاحيتك الحالية.";
  }
  return message;
}
