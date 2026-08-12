"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui";
import type { FormState } from "@/lib/form-state";

// The three pieces every converted form needs, in one place so they cannot drift apart: a field that
// knows how to show its own error, a place for errors that belong to no single field, and the toast
// that reports success.

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700";
export const inputBadCls =
  "w-full rounded-lg border border-red-400 bg-transparent px-3 py-2 text-sm outline-none dark:border-red-500";

/** The border turns red on the field that failed, so the eye finds it before the text is read. */
export function fieldCls(state: FormState, name: string): string {
  return state.field === name ? inputBadCls : inputCls;
}

/** Success is transient and needs no action, so it goes to a toast rather than holding screen space. */
export function useSuccessToast(state: FormState) {
  const { toast } = useToast();
  useEffect(() => {
    if (state.ok) toast({ title: state.ok, tone: "success" });
  }, [state.ok, toast]);
}

/**
 * A labelled input with its own error slot.
 *
 * The error replaces the hint rather than stacking under it: two lines of small grey-and-red text
 * under one box is where a message goes to be skimmed past.
 */
export function Field({
  label,
  hint,
  name,
  state,
  children,
}: {
  label: string;
  hint?: string;
  name: string;
  state: FormState;
  children: React.ReactNode;
}) {
  const message = state.field === name ? state.error : null;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor={name}>{label}</label>
      {children}
      {message ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{message}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}

/** An error with no field of its own — a throttle, a permission refusal, a provider that said no. */
export function FormError({ state }: { state: FormState }) {
  if (!state.error || state.field) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      {state.error}
    </p>
  );
}
