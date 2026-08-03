"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";

// Right-anchored sliding panel (natural start-side in RTL) for quick add/edit without a page change.
// Enter animation only (conditional mount); overlay-click and Esc close it.
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  // Raise this on a nested drawer (e.g. add-owner opened from inside the add-property drawer).
  zClass = "z-50",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  zClass?: string;
}) {
  // Focus containment, Escape and focus restoration all come from the shared trap. It replaces a
  // hand-rolled version that moved focus in and back out but never trapped Tab — so a keyboard user
  // could tab straight out of an open drawer into the page behind it. The trap also arbitrates
  // between nested drawers, which the old per-drawer Escape listener could not.
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  // Portal to <body>: a `fixed` panel would otherwise be positioned against an ancestor that has a
  // transform (e.g. another drawer mid-slide), which matters for nested drawers.
  return createPortal(
    // aria-labelledby rather than aria-label: the heading is already on screen, and pointing at it
    // keeps the two from drifting apart when one is edited.
    <div className={"fixed inset-0 " + zClass} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 animate-fade-in-plain bg-slate-900/50" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-md animate-slide-in-right flex-col bg-white shadow-xl outline-none dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
