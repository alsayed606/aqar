"use client";

import { useRef } from "react";

/**
 * A select that submits its form as soon as a value is chosen.
 *
 * Offices work from phones, where the alternative costs a third tap on every sort change (open the
 * native picker, choose, then reach for a separate apply button). With JavaScript unavailable the
 * select still posts with the surrounding GET form, so nothing is lost — the apply button is simply
 * the one doing the work.
 */
export function AutoSubmitSelect({
  name,
  value,
  label,
  options,
  className,
}: {
  name: string;
  value: string;
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const ref = useRef<HTMLSelectElement>(null);

  return (
    <select
      ref={ref}
      name={name}
      defaultValue={value}
      aria-label={label}
      onChange={() => ref.current?.form?.requestSubmit()}
      className={className}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
