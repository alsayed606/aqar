// Row shapes returned by the platform (super-admin) RPCs in migration 0048. Shared so the list and
// the single-office view describe an office the same way — they read the same function.
//
// Note what is NOT here: nothing from inside a tenant. The platform sees its own records
// (subscription, plan, payments) plus COUNTS of the tenant's data — never a tenant row.

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
