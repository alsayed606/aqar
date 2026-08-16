// Arabic labels for the enums used in the UI (mirror the DB enums in migration 0002).

export const PROPERTY_KIND_AR: Record<string, string> = {
  residential: "سكني",
  commercial: "تجاري",
  mixed_use: "مختلط",
  land: "أرض",
  other: "أخرى",
};

/** How the office holds the property: its own, managed for a client, or an investment. */
export const HOLDING_TYPE_AR: Record<string, string> = {
  owned: "مملوك",
  managed: "إدارة أملاك",
  investment: "استثمار",
};

export const UNIT_STATUS_AR: Record<string, string> = {
  vacant: "شاغرة",
  rented: "مؤجرة",
  reserved: "محجوزة",
  under_maintenance: "تحت الصيانة",
  not_rentable: "غير صالحة للتأجير",
  out_of_service: "خارج الخدمة",
};

export const UNIT_STATUS_TONE: Record<string, string> = {
  vacant: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  rented: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  reserved: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  under_maintenance: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  not_rentable: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  out_of_service: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export const CONTRACT_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  active: "نشط",
  expired: "منتهٍ",
  terminated: "مُنهى",
  cancelled: "ملغى",
};

export const CONTRACT_STATUS_TONE: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  expired: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  terminated: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export const AMENDMENT_TYPE_AR: Record<string, string> = {
  rent_change: "تعديل الإيجار",
  early_termination: "إنهاء مبكر",
  extension: "تمديد",
};

export const FREQUENCY_AR: Record<string, string> = {
  monthly: "شهري",
  quarterly: "ربع سنوي",
  semi_annual: "نصف سنوي",
  annual: "سنوي",
  one_time: "دفعة واحدة",
  custom: "مخصّص",
};

export const DOC_KIND_AR: Record<string, string> = {
  invoice: "فاتورة",
  credit_note: "إشعار دائن",
  debit_note: "إشعار مدين",
};

export const PAYMENT_METHOD_AR: Record<string, string> = {
  cash: "نقداً",
  bank_transfer: "حوالة بنكية",
  ejar: "منصة إيجار",
  mada: "مدى",
  apple_pay: "Apple Pay",
  sadad: "سداد",
  cheque: "شيك",
  card: "بطاقة",
};

export const ROLE_AR: Record<string, string> = {
  owner: "مالك",
  admin: "مدير",
  manager: "مدير محفظة",
  accountant: "محاسب",
  staff: "موظف",
  viewer: "مطّلع",
};

export const MEMBER_STATUS_AR: Record<string, string> = {
  invited: "مدعو",
  active: "نشط",
  suspended: "موقوف",
  revoked: "ملغى",
};

export const MEMBER_STATUS_TONE: Record<string, string> = {
  invited: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  suspended: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// Subscription vocabulary — read by both the platform list and the office detail view.
// `suspended` and `canceled` are different facts: we cut them off vs they left. Keeping them apart
// is what stops a suspension for non-payment from being counted as churn.
export const SUBSCRIPTION_STATUS_AR: Record<string, string> = {
  trialing: "تجريبي",
  active: "نشط",
  comped: "ممنوح",
  past_due: "متأخر",
  suspended: "موقوف",
  canceled: "ملغى",
};

export const SUBSCRIPTION_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "brand" | "warning" | "danger"> = {
  trialing: "info",
  active: "success",
  comped: "brand",
  past_due: "warning",
  suspended: "danger",
  canceled: "neutral",
};

// What changed on a subscription, in the words the console shows.
export const SUBSCRIPTION_EVENT_AR: Record<string, string> = {
  created: "بداية الاشتراك",
  plan_changed: "تغيير الخطة",
  status_changed: "تغيير الحالة",
  trial_extended: "تمديد التجربة",
  period_extended: "تمديد الفترة",
};

// Utilities module (migration 0063). meter_level is derived in the DB, never chosen by a user.
export const UTILITY_TYPE_AR: Record<string, string> = {
  electricity: "كهرباء",
  water: "ماء",
};

export const METER_STATUS_AR: Record<string, string> = {
  active: "نشط",
  inactive: "مؤرشف",
  removed: "مفكوك",
};

export const METER_LEVEL_AR: Record<string, string> = {
  main: "رئيسي",
  unit: "وحدة",
};

/** Maintenance (0072). The categories are a fixed list in the DB check constraint. */
export const MAINTENANCE_CATEGORY_AR: Record<string, string> = {
  plumbing: "سباكة",
  electrical: "كهرباء",
  hvac: "تكييف",
  carpentry: "نجارة",
  appliance: "أجهزة",
  other: "أخرى",
};

export const MAINTENANCE_URGENCY_AR: Record<string, string> = {
  normal: "عادية",
  urgent: "عاجلة",
  emergency: "طارئة",
};

export const MAINTENANCE_STATUS_AR: Record<string, string> = {
  open: "مفتوحة",
  in_progress: "قيد التنفيذ",
  resolved: "مغلقة",
  cancelled: "ملغاة",
};

/** Who bears the cost of the repair — recorded on the request, not posted to any statement. */
export const MAINTENANCE_BEARER_AR: Record<string, string> = {
  owner: "المالك",
  tenant: "المستأجر",
  office: "المكتب",
};
