"use client";

import Link from "next/link";
import { useState } from "react";
import { halalasToSar } from "@/lib/money";
import { CONTRACT_STATUS_AR } from "@/lib/labels";
import { Badge, useToast } from "@/components/ui";
import { cx } from "@/lib/cx";

// Plain (serializable) shape handed down from the server page.
export type ContractCardData = {
  id: string;
  contract_number: string;
  status: string;
  start_date: string;
  end_date: string;
  annual_rent_halalas: number;
  unit_number: string | null;
  property_name: string | null;
  property_id: string | null;
  tenant_name: string | null;
  tenant_id: string | null;
};

export type ContractBucket = "active" | "ending" | "ended" | "other";

const DAY_MS = 86_400_000;
const ENDING_SOON_DAYS = 60;

/**
 * Which filter tab a contract belongs to. `ending` is the dashboard's definition — an active
 * contract whose end_date falls inside the next 60 days — so both surfaces agree.
 */
export function contractBucket(contract: ContractCardData, today = new Date()): ContractBucket {
  const end = new Date(contract.end_date);
  if (contract.status === "expired" || contract.status === "terminated" || end < today) return "ended";
  if (contract.status !== "active") return "other";
  return end.getTime() - today.getTime() <= ENDING_SOON_DAYS * DAY_MS ? "ending" : "active";
}

const BUCKET_TONE = {
  active: "success",
  ending: "warning",
  ended: "danger",
  other: "neutral",
} as const;

const BUCKET_LABEL: Record<ContractBucket, string> = {
  active: "نشط",
  ending: "ينتهي قريباً",
  ended: "منتهي",
  other: "",
};

// Share of the contract term already elapsed, clamped to 0–100.
function elapsedPercent(startDate: string, endDate: string, today = new Date()): number {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!(end > start)) return 0;
  return Math.min(100, Math.max(0, Math.round(((today.getTime() - start) / (end - start)) * 100)));
}

function Icon({ path, className }: { path: React.ReactNode; className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {path}
    </svg>
  );
}

export function ContractCard({ contract }: { contract: ContractCardData }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { toast } = useToast();
  const bucket = contractBucket(contract);
  const progress = elapsedPercent(contract.start_date, contract.end_date);
  const statusLabel = BUCKET_LABEL[bucket] || (CONTRACT_STATUS_AR[contract.status] ?? contract.status);

  async function copyNumber() {
    await navigator.clipboard.writeText(contract.contract_number);
    toast({ title: `نُسخ رقم العقد ${contract.contract_number}`, tone: "success" });
  }

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-brand hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      {/* Header: number + copy · status + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-bold text-slate-900 dark:text-white" dir="ltr">
            {contract.contract_number}
          </span>
          <button
            type="button"
            onClick={copyNumber}
            aria-label="نسخ رقم العقد"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800"
          >
            <Icon path={<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <Badge tone={BUCKET_TONE[bucket]}>{statusLabel}</Badge>
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
                  <li><Link href={`/app/contracts/${contract.id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">عرض العقد</Link></li>
                  <li><Link href={`/app/contracts/${contract.id}/print`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">طباعة العقد</Link></li>
                  {contract.property_id && (
                    <li><Link href={`/app/properties/${contract.property_id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">العقار</Link></li>
                  )}
                  {contract.tenant_id && (
                    <li><Link href={`/app/tenants/${contract.tenant_id}`} className="block px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">المستأجر</Link></li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body: tenant + property·unit */}
      <div className="mt-3">
        <p className="flex items-center gap-1.5 text-lg font-semibold text-slate-900 dark:text-white">
          <Icon path={<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></>} className="shrink-0 text-slate-400" />
          {contract.tenant_name ?? "—"}
        </p>
        <span className="mt-2 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {contract.property_name ?? "—"} • وحدة {contract.unit_number ?? "—"}
        </span>
      </div>

      {/* Financial + timeline */}
      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <p className="text-xl font-bold text-slate-900 dark:text-white">
          {halalasToSar(contract.annual_rent_halalas)}
          <span className="mr-1 text-sm font-medium text-slate-500">ر.س / سنوياً</span>
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500" dir="ltr">
          <span>{contract.start_date}</span>
          <span>{contract.end_date}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={cx("h-full rounded-full transition-all", bucket === "ended" ? "bg-slate-400" : bucket === "ending" ? "bg-amber-500" : "bg-brand")}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-slate-400">انقضى {progress}% من مدة العقد</p>
      </div>

      {/* Footer actions */}
      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Link
          href={`/app/contracts/${contract.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-fg"
        >
          <Icon path={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>} />
          عرض العقد
        </Link>
        <Link
          href={`/app/contracts/${contract.id}/print`}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Icon path={<><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></>} />
          طباعة
        </Link>
      </div>
    </article>
  );
}
