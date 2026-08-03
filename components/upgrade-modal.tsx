"use client";

import { useId } from "react";
import Link from "next/link";
import { useFocusTrap } from "@/lib/use-focus-trap";

// "Upgrade required" overlay shown when a plan limit is hit (over the 0036 enforcement).
//
// This had no dialog semantics at all before the launch sprint — no role, no aria-modal, no Escape,
// no focus management — so a keyboard user could tab straight past it into the page behind, and a
// screen reader never announced that anything had opened.
export function UpgradeModal({
  open,
  message,
  onClose,
}: {
  open: boolean;
  message?: string;
  // Optional: some callers render this as a terminal state with no way back, and forcing a close
  // handler on them would mean inventing one that does nothing.
  onClose?: () => void;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const titleId = useId();
  const descId = useId();

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-xl outline-none dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="mb-2 text-3xl" aria-hidden="true">⭐</div>
        <h3 id={titleId} className="mb-1 text-lg font-bold">ترقية مطلوبة</h3>
        <p id={descId} className="mb-5 text-sm text-neutral-600 dark:text-neutral-400">
          {message ?? "بلغت الحد الأقصى لخطتك الحالية. رقِّ خطتك للمتابعة."}
        </p>
        <div className="flex justify-center gap-2">
          <Link
            href="/app/subscription"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg"
          >
            اشترك الآن
          </Link>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              إغلاق
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
