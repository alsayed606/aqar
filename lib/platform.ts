// Row shapes returned by the platform (super-admin) RPCs in migration 0048. Shared so the list and
// the single-office view describe an office the same way — they read the same function.
//
// Note what is NOT here: nothing from inside a tenant. The platform sees its own records
// (subscription, plan, payments) plus COUNTS of the tenant's data — never a tenant row.

// The plan catalog is DATA (0036) and editable from the console since T-3, so every screen that
// offers a plan reads it from app.plan. A hardcoded list here would silently omit any plan the
// operator adds.
export type PlanOption = { code: string; name_ar: string };

// Every error code the platform functions raise, in one place. PostgREST hands back the raw
// message with the code embedded, so matching on the code is what turns NOT_TRIALING into a
// sentence an operator can act on. Scattered copies of this map meant a new code was translated
// in one action and shown raw in the other three.
export const PLATFORM_ERRORS_AR: Record<string, string> = {
  FORBIDDEN: "غير مصرّح",
  SUBSCRIPTION_NOT_FOUND: "لا يوجد اشتراك لهذا المكتب",
  NOT_TRIALING: "التمديد يخصّ الحسابات التجريبية فقط",
  INVALID_DAYS: "عدد أيام غير صالح",
  PLAN_NOT_FOUND: "الخطة غير موجودة",
  INVALID_PLAN_CODE: "رمز الخطة يجب أن يكون حروفاً إنجليزية صغيرة",
  NAME_REQUIRED: "الاسم مطلوب",
  INVALID_PRICE: "سعر غير صالح",
  INVALID_LIMIT: "حد غير صالح",
  INVALID_FLAG_KEY: "مفتاح الميزة يجب أن يكون حروفاً إنجليزية صغيرة",
  INVALID_ROLLOUT: "نسبة الإطلاق بين 0 و 100",
  UNKNOWN_SETTING: "إعداد غير معروف",
  INVALID_SETTING: "قيمة غير صالحة",
  TITLE_REQUIRED: "العنوان مطلوب",
  INVALID_CHANNEL: "قناة غير معروفة",
};

// Falls back to the raw message rather than a generic apology: an untranslated code is a gap in
// the map above, and hiding it behind "حدث خطأ" would hide the gap too.
export function platformErrorAr(message: string): string {
  const code = Object.keys(PLATFORM_ERRORS_AR).find((c) => message.includes(c));
  return code ? PLATFORM_ERRORS_AR[code] : message;
}

export type PlatformOrgRow = {
  org_id: string;
  org_name: string;
  created_at: string | null;
  plan_code: string | null;
  plan_name_ar: string | null;
  plan_price_halalas: number | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  properties: number;
  units: number;
  members: number;
  max_properties: number | null;
  max_units: number | null;
  max_members: number | null;
  last_sign_in_at: string | null;
  active_today: number;
  total_count: number;
};

// platform_tenant_360(org). `portfolio` is counts of what the office manages and `revenue` is what
// the office paid US — the office's own collections are its business and are not in this payload.
// `team` is the exception the console needs: the identities that sign in to our platform, because
// support cannot help an office without knowing who to call. Its customers stay counts.
export type Tenant360 = {
  org: { id: string; name: string; org_type: string | null; created_at: string };
  subscription: {
    plan_code: string | null; plan_name: string | null; price_halalas: number | null;
    status: string | null; trial_ends_at: string | null; current_period_end: string | null;
    auto_renew: boolean | null; notes: string | null; active: boolean;
  } | null;
  limits: { properties: number | null; units: number | null; members: number | null };
  usage: { properties: number; units: number; members: number };
  portfolio: {
    properties: number; units: number; units_rented: number; units_vacant: number;
    contracts: number; contracts_active: number; owners: number; tenants: number;
  };
  revenue: { paid_halalas: number; payments: number; last_paid_at: string | null; failed_30d: number };
  payment_method: { brand: string | null; last4: string | null; exp_month: number | null; exp_year: number | null } | null;
  team: {
    identity_id: string; full_name: string | null; email: string | null; phone_e164: string | null;
    role: string; status: string; scope_all: boolean; joined_at: string; last_sign_in_at: string | null;
  }[];
  activity: { last_sign_in_at: string | null; active_today: number };
  import_batches: number;
  generated_at: string;
};

// platform_alerts() returns a stable `kind` and leaves the wording and the destination to the UI,
// so SQL never carries a route. Anything the function can emit must have an entry here.
export type AlertRow = { kind: string; severity: number; count: number; detail: unknown };

export const ALERT_META: Record<string, { title: string; hint: string; href: string }> = {
  cron_failed: {
    title: "فشل مهمة مجدولة",
    hint: "المهمة الفاشلة تُخفي بقية التنبيهات: الطوابير التي تُصرّفها تتوقف",
    href: "/platform/health",
  },
  email_failed: { title: "رسائل بريد فشلت نهائياً", hint: "استُنفدت محاولاتها", href: "/platform/health" },
  email_overdue: { title: "بريد متأخر في الطابور", hint: "حان موعد إعادة إرساله ولم يُرسَل", href: "/platform/health" },
  payment_failed: { title: "مدفوعات فاشلة (٧ أيام)", hint: "راجع أسباب الفشل", href: "/platform/billing?status=failed" },
  payment_awaiting_webhook: {
    title: "عمليات بانتظار إشعار البوابة",
    hint: "بدأت ولم يصل إشعارها — قد يكون الـwebhook متوقفاً",
    href: "/platform/billing?status=initiated",
  },
  subscription_past_due: { title: "اشتراكات متأخرة", hint: "إيراد معرّض للخطر", href: "/platform/tenants?status=past_due" },
  trial_lapsed: { title: "تجارب منقضية بلا قرار", hint: "انتهى تاريخها ولم يُبتّ فيها", href: "/platform/subscriptions" },
  renewal_without_card: {
    title: "تجديد قريب بلا بطاقة محفوظة",
    hint: "لن يُجدَّد تلقائياً وسينقضي بصمت",
    href: "/platform/subscriptions",
  },
  limit_reached: { title: "مكاتب بلغت سقف خطتها", hint: "فرصة ترقية، لا عُطل", href: "/platform/tenants" },
};

export type SubscriptionEventRow = {
  id: number;
  kind: string;
  from_plan: string | null;
  to_plan: string | null;
  from_status: string | null;
  to_status: string | null;
  plan_price_halalas: number;
  detail: { reconstructed?: boolean } | null;
  created_at: string;
};
