"use client";

import { useRef, useState } from "react";

/**
 * An Arabic file picker.
 *
 * A bare `<input type="file">` renders the browser's own chrome — "Choose File", "No file chosen" —
 * in the browser's language, not the page's. On an otherwise fully Arabic screen that is two
 * English strings the office cannot change and we cannot translate.
 *
 * So the real input is hidden (still in the form, still `required`, still the thing that carries
 * the bytes) and a label drives it. The chosen file name is echoed back, because a picker that
 * gives no feedback after a click is a worse problem than an English one.
 */
export function FilePicker({
  name,
  accept,
  required,
  label = "اختيار ملف…",
}: {
  name: string;
  accept?: string;
  required?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {label}
      </button>
      <span className="text-xs text-slate-500">{fileName ?? "لم يُختَر ملف"}</span>
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        required={required}
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        className="sr-only"
      />
    </div>
  );
}
