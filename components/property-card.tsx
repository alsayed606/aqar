"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { PROPERTY_KIND_AR } from "@/lib/labels";
import { halalasToSar } from "@/lib/money";
import { deleteProperty } from "@/app/app/properties/actions";

// One property as a card, matching the owners / tenants / contracts grids. The properties list was
// the last one still rendering a seven-column table.
//
// Two of those columns — units and vacant — were two numbers the reader had to subtract in their
// head, once per row. They are one bar here: an office scanning twenty buildings looks for the short
// bar, not for a number.

export type PropertyCardData = {
  id: string;
  name: string;
  property_kind: string;
  property_code: string | null;
  holding_type: string;
  city: string | null;
  district: string | null;
  has_deed: boolean;
  has_owner: boolean;
  units: number;
  rented: number;
  vacant: number;
  /** Units with no area recorded — the field an import most often leaves empty. */
  missingArea: number;
  /** Sum of the ACTIVE contracts on the property. Zero means nothing is contracted today. */
  annualRentHalalas: number;
};

export type PropertyBucket = "vacancy" | "full" | "empty";

/** What the office triages by: which buildings have something to let, and which were left half-entered. */
export function propertyBucket(p: PropertyCardData): PropertyBucket {
  if (p.units === 0) return "empty";
  return p.vacant > 0 ? "vacancy" : "full";
}

const HOLDING_AR: Record<string, string> = { owned: "مملوك", managed: "إدارة أملاك", investment: "استثمار" };

function Icon({ path, className }: { path: React.ReactNode; className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {path}
    </svg>
  );
}

/**
 * A fact that is either recorded or not.
 *
 * The deed number itself was dropped from the card: nobody reads a deed number off a list, they only
 * need to know whether one is on file. The same is true of the rest — a code, an owner, the unit
 * areas. So each is a word and a mark, and the mark carries its meaning in text as well as colour
 * for anyone who cannot tell the two apart.
 */
function Mark({ label, ok, missingHint }: { label: string; ok: boolean; missingHint: string }) {
  return (
    <span
      title={ok ? `${label}: مسجّل` : missingHint}
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs " +
        (ok
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300"
          : "bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-300")
      }
    >
      {label}
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
      <span className="sr-only">{ok ? "مسجّل" : "غير مسجّل"}</span>
    </span>
  );
}

export function PropertyCard({ property, canData }: { property: PropertyCardData; canData: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { units, rented, vacant } = property;
  const occupancy = units === 0 ? 0 : Math.round((rented / units) * 100);
  const place = [property.city, property.district].filter(Boolean).join(" · ");
  const item = "block w-full px-3 py-1.5 text-right hover:bg-slate-50 dark:hover:bg-slate-800";

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:border-brand hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white">
            <Icon path={<><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M10 21v-6h4v6" /></>} className="shrink-0 text-slate-400" />
            <Link href={`/app/properties/${property.id}`} className="truncate hover:text-brand hover:underline">
              {property.name}
            </Link>
          </h3>
          {place && <p className="mt-0.5 pr-6 text-xs text-slate-500">{place}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Badge tone="neutral">{PROPERTY_KIND_AR[property.property_kind] ?? property.property_kind}</Badge>
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
                <ul className="absolute left-0 z-20 mt-1 w-44 animate-fade-in overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <li><Link href={`/app/properties/${property.id}`} className={item}>عرض / تعديل</Link></li>
                  <li><Link href={`/app/properties/${property.id}/report`} className={item}>تقرير الوحدات</Link></li>
                  <li><a href={`/api/export/units?property=${property.id}`} className={item}>⬇ تصدير الوحدات</a></li>
                  {/* Offered only while the property is empty. The 0067 guard refuses the rest
                      anyway, and an option that always fails is not a safeguard — it is a promise
                      the card cannot keep. */}
                  {canData && units === 0 && (
                    <li>
                      <form action={deleteProperty}>
                        <input type="hidden" name="property_id" value={property.id} />
                        <ConfirmButton
                          message={`حذف العقار «${property.name}»؟ يبقى سجلّه محفوظاً.`}
                          className={item + " text-red-600"}
                        >
                          حذف
                        </ConfirmButton>
                      </form>
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Mark label="صك" ok={property.has_deed} missingHint="لا يوجد رقم صك مسجّل على العقار" />
        <Mark label="مالك" ok={property.has_owner} missingHint="العقار غير مربوط بمالك" />
        <Mark label="كود" ok={!!property.property_code} missingHint="لا يوجد كود داخلي للعقار" />
        {units > 0 && (
          <Mark
            label="مساحات الوحدات"
            ok={property.missingArea === 0}
            missingHint={`${property.missingArea} وحدة بلا مساحة مسجّلة`}
          />
        )}
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {HOLDING_AR[property.holding_type] ?? property.holding_type}
        </span>
      </div>

      <div className="mt-4 flex-1 border-t border-slate-100 pt-3 dark:border-slate-800">
        {units === 0 ? (
          <p className="text-sm text-slate-500">لا توجد وحدات بعد.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">الإشغال</span>
              <span className="text-slate-500">{rented} من {units} وحدة</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-brand" style={{ width: `${occupancy}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {occupancy}%{vacant > 0 && <> · {vacant} شاغرة</>}
            </p>
            {property.annualRentHalalas > 0 && (
              <p className="mt-2 text-sm">
                <span className="text-slate-500">الإيجار التعاقدي السنوي: </span>
                <span className="font-bold tabular-nums" dir="ltr">{halalasToSar(property.annualRentHalalas)}</span>
                <span className="text-xs text-slate-500"> ر.س</span>
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Link
          href={`/app/properties/${property.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-fg"
        >
          فتح العقار
        </Link>
        <Link
          href={`/app/properties/${property.id}/report`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          تقرير
        </Link>
      </div>
    </article>
  );
}
