// Tenant identity vocabulary, shared by the tenant form, the server actions and the list page.
// The rule (migration 0057): an individual is identified by ONE of national id / iqama / passport;
// an establishment is identified by its unified (700) number and must name a representative.

export type EntityType = "individual" | "sole_establishment" | "company";
export type PersonIdKind = "national_id" | "iqama_id" | "passport_no";

export const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "individual", label: "فرد" },
  { value: "sole_establishment", label: "مؤسسة فردية" },
  { value: "company", label: "شركة" },
];

// Patterns mirror app.id_pattern(). They live here too because the browser has to reject a bad
// value before a round trip; the database remains the authority.
export const PERSON_ID_KINDS: { value: PersonIdKind; label: string; pattern: string; hint: string }[] = [
  { value: "national_id", label: "هوية وطنية", pattern: "^1[0-9]{9}$", hint: "10 أرقام تبدأ بـ 1" },
  { value: "iqama_id", label: "إقامة", pattern: "^2[0-9]{9}$", hint: "10 أرقام تبدأ بـ 2" },
  { value: "passport_no", label: "جواز سفر", pattern: "^[A-Za-z0-9]{3,20}$", hint: "أرقام وحروف" },
];

export const UNIFIED_PATTERN = "^7[0-9]{9}$";
export const CR_PATTERN = "^[0-9]{10}$";
export const VAT_PATTERN = "^3[0-9]{13}3$";

export function isEstablishment(type: string): boolean {
  return type === "sole_establishment" || type === "company";
}

// The database raises these as bare codes so every caller can translate them the same way.
const TENANT_ERRORS_AR: Record<string, string> = {
  IDENTITY_INCOMPLETE: "أكمل المعرّف الرئيسي: الهوية للفرد، أو الرقم الموحّد وبيانات الممثل للمنشأة",
  DUPLICATE_IDENTIFIER: "يوجد مستأجر مسجّل بنفس المعرّف",
  INVALID_NATIONAL_ID: "رقم الهوية الوطنية يجب أن يكون 10 أرقام تبدأ بـ 1",
  INVALID_IQAMA_ID: "رقم الإقامة يجب أن يكون 10 أرقام تبدأ بـ 2",
  INVALID_PASSPORT: "رقم الجواز غير صالح",
  INVALID_UNIFIED_NUMBER: "الرقم الموحّد يجب أن يكون 10 أرقام تبدأ بـ 7",
  INVALID_CR_NUMBER: "السجل التجاري يجب أن يكون 10 أرقام",
  INVALID_VAT_NUMBER: "الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بـ 3",
  INVALID_REP_ID: "هوية الممثل يجب أن تكون 10 أرقام تبدأ بـ 1 أو 2",
  party_one_personal_id: "اختر نوع هوية واحداً فقط",
  party_rep_phone_fmt: "جوال الممثل غير صالح (مثال: 05XXXXXXXX)",
};

export function tenantErrorAr(message: string): string {
  for (const [code, ar] of Object.entries(TENANT_ERRORS_AR)) {
    if (message.includes(code)) return ar;
  }
  return message;
}
