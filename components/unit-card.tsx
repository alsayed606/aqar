"use client";

import Link from "next/link";
import { useState } from "react";
import { halalasToSar } from "@/lib/money";
import { UNIT_STATUS_AR, PROPERTY_KIND_AR } from "@/lib/labels";
import { Badge } from "@/components/ui";
import { UnitEditDrawer } from "@/components/unit-edit-drawer";

// Plain (serializable) shape handed down from the server page. Tenant + rent come from the unit's
// active contract, which is why a vacant unit carries none.
export type UnitCardData = {
  id: string;
  unit_number: string;
  current_status: string;
  floor: string | null;
  area_sqm: number | string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  property_id: string | null;
  property_name: string | null;
  property_kind: string | null;
  tenant_name: string | null;
  annual_rent_halalas: number | null;
  contract_id: string | null;
};

export type UnitBucket = "vacant" | "rented" | "maintenance" | "other";

/** Which filter tab a unit belongs to. `other` keeps reserved / not-rentable / out-of-service visible. */
export function unitBucket(status: string): UnitBucket {
  if (status === "vacant") return "vacant";
  if (status === "rented") return "rented";
  if (status === "under_maintenance") return "maintenance";
  return "other";
}

const BUCKET_TONE = {
  vacant: "info",
  rented: "success",
  maintenance: "warning",
  other: "neutral",
} as const;

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

export function UnitCard({ unit, canData }: { unit: UnitCardData; canData: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const bucket = unitBucket(unit.current_status);
  const isVacant = bucket === "vacant";

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:border-brand hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      {/* Header: unit number · status + actions */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">وحدة {unit.unit_number}</h3>

        <div className="flex items-center gap-1">
          <Badge tone={BUCKET_TONE[bucket]}>{UNIT_STATUS_AR[unit.current_status] ?? unit.current_status}</Badge>
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
                  {unit.property_id && (
                    <li><Link href={`/app/properties/${unit.property_id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">العقار</Link></li>
                  )}
                  {unit.contract_id && (
                    <li><Link href={`/app/contracts/${unit.contract_id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">العقد الحالي</Link></li>
                  )}
                  {isVacant && (
                    <li><Link href={`/app/contracts?add=1&unit=${unit.id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">إنشاء عقد</Link></li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body: property + spec chips */}
      <div className="mt-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
          <Icon path={<><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6" /></>} className="shrink-0 text-slate-400" />
          {unit.property_name ?? "—"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unit.property_kind && <Chip>{PROPERTY_KIND_AR[unit.property_kind] ?? unit.property_kind}</Chip>}
          {unit.floor && <Chip>الدور {unit.floor}</Chip>}
          {unit.area_sqm != null && <Chip>{unit.area_sqm} م²</Chip>}
          {unit.bedrooms != null && <Chip>{unit.bedrooms} غرف</Chip>}
        </div>
      </div>

      {/* Occupancy */}
      <div className="mt-4 flex-1 border-t border-slate-100 pt-3 dark:border-slate-800">
        {bucket === "rented" && unit.tenant_name ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
              <Icon path={<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></>} className="shrink-0 text-slate-400" />
              {unit.tenant_name}
            </p>
            {unit.annual_rent_halalas != null && (
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {halalasToSar(unit.annual_rent_halalas)}
                <span className="mr-1 text-xs font-medium text-slate-500">ر.س / سنوياً</span>
              </p>
            )}
          </>
        ) : isVacant ? (
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">شاغرة — جاهزة للتأجير</p>
        ) : (
          <p className="text-sm text-slate-500">{UNIT_STATUS_AR[unit.current_status] ?? unit.current_status}</p>
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Link
          href={unit.property_id ? `/app/properties/${unit.property_id}` : "/app/properties"}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Icon path={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>} />
          عرض التفاصيل
        </Link>

        {isVacant && (
          <Link
            href={`/app/contracts?add=1&unit=${unit.id}`}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-fg"
          >
            <Icon path={<path d="M12 5v14M5 12h14" />} />
            إنشاء عقد
          </Link>
        )}

        {canData && <UnitEditDrawer unit={unit} />}
      </div>
    </article>
  );
}
