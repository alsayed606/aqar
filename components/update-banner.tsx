"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "A new version is out — reload."
 *
 * Vercel serves a new deployment the moment it is ready, while open tabs keep running the old
 * bundle. Next notices the mismatch at the next server action and recovers with a hard reload — but
 * that lands mid-form, and everything typed is lost. This asks first.
 *
 * SILENT WHENEVER IT CANNOT BE SURE. An empty id on either side (local dev, a host that sets no
 * such variable, a failed request) means no banner. A reload prompt that appears when nothing has
 * changed teaches people to ignore the one that matters.
 */

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
/** Five minutes. Often enough to catch a deploy, rare enough to be invisible in the network tab. */
const POLL_MS = 5 * 60 * 1000;

export function UpdateBanner() {
  const [stale, setStale] = useState(false);

  const check = useCallback(async () => {
    if (!BUILD_ID || stale) return;
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const { id } = (await res.json()) as { id?: string };
      if (id && id !== BUILD_ID) setStale(true);
    } catch {
      // Offline, or the request was cut short. Nothing to tell the user: a failed check is not
      // evidence of a new version, and this banner speaks only from evidence.
    }
  }, [stale]);

  useEffect(() => {
    if (!BUILD_ID) return;
    // On focus as well as on a timer: the tab left open over lunch is exactly the one running an
    // old bundle, and it asks the moment its owner comes back to it.
    const onFocus = () => void check();
    const timer = setInterval(() => void check(), POLL_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  if (!stale) return null;

  return (
    <div
      role="status"
      className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-900/40 dark:bg-sky-900/20 dark:text-sky-200"
    >
      <span>
        <b>صدر تحديث للنظام.</b> أعِد تحميل الصفحة لتعمل على أحدث نسخة — واحفظ ما تكتبه أوّلاً.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800"
      >
        إعادة التحميل
      </button>
    </div>
  );
}
