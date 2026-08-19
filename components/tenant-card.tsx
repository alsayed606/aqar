"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui";

export type TenantCardData = {
  id: string;
  display_name: string;
  tenant_type: string;
  /** National id / iqama / passport for a person, unified number for an establishment. */
  primary_id: string | null;
  identity_complete: boolean;
  phone_e164: string | null;
  active_contracts: number;
  units: string[];
};

export type TenantBucket = "individual" | "sole_establishment" | "company";

export function tenantBucket(tenant: TenantCardData): TenantBucket {
  return tenant.tenant_type === "company"
    ? "company"
    : tenant.tenant_type === "sole_establishment"
      ? "sole_establishment"
      : "individual";
}

const BUCKET_LABEL: Record<TenantBucket, string> = {
  individual: "فرد",
  sole_establishment: "مؤسسة فردية",
  company: "شركة",
};

const BUCKET_TONE = { individual: "neutral", sole_establishment: "info", company: "brand" } as const;

function Icon({ path, className }: { path: React.ReactNode; className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {path}
    </svg>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

export function TenantCard({ tenant }: { tenant: TenantCardData }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const bucket = tenantBucket(tenant);
  const isEstablishment = bucket !== "individual";

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:border-brand hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white">
          <Icon
            path={
              isEstablishment
                ? <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6" /></>
                : <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></>
            }
            className="shrink-0 text-slate-400"
          />
          {tenant.display_name}
        </h3>

        <div className="flex items-center gap-1">
          {/* Records that predate the identity rule stay editable; the badge is how they surface. */}
          {!tenant.identity_complete && <Badge tone="warning">بيانات ناقصة</Badge>}
          <Badge tone={BUCKET_TONE[bucket]}>{BUCKET_LABEL[bucket]}</Badge>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="خيارات"
              aria-expanded={menuOpen}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <Icon path={<><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <ul className="absolute left-0 z-20 mt-1 w-40 animate-fade-in overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <li><Link href={`/app/tenants/${tenant.id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">تعديل البيانات</Link></li>
                  <li><Link href="/app/contracts" className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">العقود</Link></li>
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tenant.primary_id && <Chip><span dir="ltr">{tenant.primary_id}</span></Chip>}
        {tenant.phone_e164 && <Chip><span dir="ltr">{tenant.phone_e164}</span></Chip>}
      </div>

      <div className="mt-4 flex-1 border-t border-slate-100 pt-3 dark:border-slate-800">
        {tenant.active_contracts > 0 ? (
          <>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {tenant.active_contracts} عقد نشط
            </p>
            {tenant.units.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">{tenant.units.join(" · ")}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">لا توجد عقود نشطة</p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Link
          href={`/app/tenants/${tenant.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Icon path={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>} />
          عرض التفاصيل
        </Link>
        {/* Portal access moved to the tenant's page (0075): sending an invitation now needs an
            address and produces a real message, and its state belongs beside the record it is
            about — not behind a button in a list. */}
        <Link
          href={`/app/tenants/${tenant.id}#portal`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          البوابة
        </Link>
      </div>
    </article>
  );
}
