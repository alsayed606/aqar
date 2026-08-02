// Import kinds + the Arabic column headers each sheet must have. These MUST match the parsers in
// migration 0016 (app.import_validate) and the templates in supabase/templates / public/templates.

export const IMPORT_KINDS = [
  "properties",
  "units",
  "owners",
  "tenants",
  "contracts",
  "charges",
] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number];

export const KIND_LABEL: Record<ImportKind, string> = {
  properties: "العقارات",
  units: "الوحدات",
  owners: "الملّاك",
  tenants: "المستأجرون",
  contracts: "العقود",
  charges: "الاستحقاقات",
};

export const KIND_TEMPLATE: Record<ImportKind, string> = {
  properties: "/templates/template_properties.xlsx",
  units: "/templates/template_units.xlsx",
  owners: "/templates/template_owners.xlsx",
  tenants: "/templates/template_tenants.xlsx",
  contracts: "/templates/template_contracts.xlsx",
  charges: "/templates/template_charges.xlsx",
};

export const HEADERS: Record<ImportKind, string[]> = {
  properties: ["اسم العقار", "نوع العقار", "رقم الصك", "المدينة", "الحي", "العنوان", "اسم المالك"],
  units: ["اسم العقار", "رقم الوحدة", "الدور", "المساحة", "غرف النوم", "دورات المياه", "الحالة"],
  owners: ["الاسم", "النوع", "رقم الهوية", "الجوال", "الآيبان", "البنك"],
  // An individual needs exactly one of الهوية/الإقامة/الجواز; an establishment needs الرقم الموحد
  // plus its representative (0057/0058). The validator names the offending column per row.
  tenants: [
    "الاسم", "النوع", "رقم الهوية", "رقم الإقامة", "رقم الجواز", "الجوال", "البريد الإلكتروني",
    "الرقم الموحد", "السجل التجاري", "الرقم الضريبي",
    "اسم الممثل", "رقم هوية الممثل", "صفة الممثل", "جوال الممثل",
  ],
  contracts: [
    "رقم العقد", "اسم العقار", "رقم الوحدة", "اسم المستأجر", "رقم هوية المستأجر",
    "تاريخ البداية", "تاريخ النهاية", "الإيجار السنوي", "دورية الدفع", "التأمين",
    "رسوم الخدمات", "رقم عقد إيجار", "رقم الصك", "الاسم التجاري",
  ],
  charges: ["رقم العقد", "نوع الاستحقاق", "تاريخ الاستحقاق", "المبلغ قبل الضريبة", "نسبة الضريبة", "الوصف"],
};

// The order in which kinds should be imported (references must exist first).
export const IMPORT_ORDER_HINT =
  "الترتيب المقترح: العقارات ← الوحدات ← المستأجرون ← العقود ← الاستحقاقات.";
