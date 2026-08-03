"use client";

import { useState } from "react";
import { exportOrgData } from "@/app/app/privacy/actions";

// Turns the server-produced JSON into a download. The file is built in the browser from the string
// the action returns, so the export never becomes a URL that could be shared or logged.
export function OrgExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await exportOrgData();
    setBusy(false);
    if (result.error || !result.json) {
      setError(result.error ?? "تعذّر إنشاء الملف.");
      return;
    }
    const url = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `aqar-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {busy ? "جارٍ التجهيز…" : "تنزيل نسخة من بياناتي"}
      </button>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
