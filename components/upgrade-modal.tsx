"use client";

import Link from "next/link";

// "Upgrade required" overlay shown when a plan limit is hit (over the 0036 enforcement).
export function UpgradeModal({ open, message }: { open: boolean; message?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-2 text-3xl">⭐</div>
        <h3 className="mb-1 text-lg font-bold">ترقية مطلوبة</h3>
        <p className="mb-5 text-sm text-neutral-600 dark:text-neutral-400">
          {message ?? "بلغت الحد الأقصى لخطتك الحالية. رقِّ خطتك للمتابعة."}
        </p>
        <div className="flex justify-center gap-2">
          <Link
            href="/app/subscription"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            اشترك الآن
          </Link>
        </div>
      </div>
    </div>
  );
}
