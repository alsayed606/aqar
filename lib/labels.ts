// Arabic labels for the enums used in the UI (mirror the DB enums in migration 0002).

export const PROPERTY_KIND_AR: Record<string, string> = {
  residential: "سكني",
  commercial: "تجاري",
  mixed_use: "مختلط",
  land: "أرض",
  other: "أخرى",
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

export const FREQUENCY_AR: Record<string, string> = {
  monthly: "شهري",
  quarterly: "ربع سنوي",
  semi_annual: "نصف سنوي",
  annual: "سنوي",
  one_time: "دفعة واحدة",
  custom: "مخصّص",
};

export const PAYMENT_METHOD_AR: Record<string, string> = {
  cash: "نقداً",
  bank_transfer: "تحويل بنكي",
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
