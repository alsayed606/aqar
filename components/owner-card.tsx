"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { OwnerPortalInvite } from "@/components/owner-portal-invite";

export type OwnerCardData = {
  id: string;
  display_name: string;
  is_self: boolean;
  owner_kind: string;
  national_id: string | null;
  phone_e164: string | null;
  iban: string | null;
  bank_name: string | null;
  property_count: number;
};

export type OwnerBucket = "self" | "individual" | "company";

export function ownerBucket(owner: OwnerCardData): OwnerBucket {
  if (owner.is_self) return "self";
  return owner.owner_kind === "company" ? "company" : "individual";
}

const BUCKET_LABEL: Record<OwnerBucket, string> = {
  self: "المنشأة",
  individual: "فرد",
  company: "شركة",
};

const BUCKET_TONE = { self: "brand", individual: "neutral", company: "info" } as const;

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

// Show only the tail of the IBAN — the full value lives on the owner page, where changing it is gated.
function maskIban(iban: string): string {
  return iban.length <= 4 ? iban : `•••• ${iban.slice(-4)}`;
}

export function OwnerCard({ owner }: { owner: OwnerCardData }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const bucket = ownerBucket(owner);
  const name = owner.is_self ? "المنشأة (مالك ذاتي)" : owner.display_name;

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:border-brand hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white">
          <Icon path={<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></>} className="shrink-0 text-slate-400" />
          {name}
        </h3>

        <div className="flex items-center gap-1">
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
                <ul className="absolute left-0 z-20 mt-1 w-44 animate-fade-in overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <li><Link href={`/app/owners/${owner.id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">كشف الحساب</Link></li>
                  <li><Link href={`/app/owners/${owner.id}/statement`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">كشف قابل للطباعة</Link></li>
                  <li><Link href="/app/properties" className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">العقارات</Link></li>
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {owner.national_id && <Chip><span dir="ltr">{owner.national_id}</span></Chip>}
        {owner.phone_e164 && <Chip><span dir="ltr">{owner.phone_e164}</span></Chip>}
        {owner.iban && <Chip><span dir="ltr">{maskIban(owner.iban)}</span>{owner.bank_name ? ` · ${owner.bank_name}` : ""}</Chip>}
      </div>

      <div className="mt-4 flex-1 border-t border-slate-100 pt-3 dark:border-slate-800">
        <p className="text-lg font-bold text-slate-900 dark:text-white">
          {owner.property_count}
          <span className="mr-1 text-xs font-medium text-slate-500">عقار في محفظته</span>
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Link
          href={`/app/owners/${owner.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-fg"
        >
          <Icon path={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>} />
          كشف الحساب
        </Link>
        {!owner.is_self && <OwnerPortalInvite ownerId={owner.id} />}
      </div>
    </article>
  );
}
