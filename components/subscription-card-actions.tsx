"use client";

import { useActionState } from "react";
import { useSuccessToast } from "@/components/form-field";
import { ConfirmButton } from "@/components/confirm-button";
import { setAutoRenew, removeCard, startSubscriptionCheckout } from "@/app/app/subscription/actions";
import type { FormState } from "@/lib/form-state";

// The three money buttons on the subscription screen.
//
// They were plain server-action forms in a server component, which meant every refusal became a
// `?error=` reload: the page came back, the message sat at the top, and on a screen where the answer
// matters most — "متاح لمدير المنشأة فقط" — it was furthest from the button that caused it.

const initial: FormState = {};

const outline =
  "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800";

function Refusal({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">
      {state.error}
    </p>
  );
}

export function AutoRenewToggle({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState(setAutoRenew, initial);
  useSuccessToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <button disabled={pending} className={outline}>
        {pending ? "…" : on ? "إيقاف" : "تفعيل"}
      </button>
      <Refusal state={state} />
    </form>
  );
}

export function RemoveCardButton() {
  const [state, action, pending] = useActionState(removeCard, initial);
  useSuccessToast(state);
  return (
    <form action={action}>
      {/* Removing the card also stops auto-renew, so the office is told before it happens rather
          than discovering it when the subscription lapses. */}
      <ConfirmButton
        message="إزالة البطاقة توقف التجديد التلقائي أيضاً. هل تريد المتابعة؟"
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-red-900/20"
      >
        {pending ? "…" : "إزالة البطاقة"}
      </ConfirmButton>
      <Refusal state={state} />
    </form>
  );
}

/**
 * The plans form. One form, and the button that was clicked carries the plan.
 *
 * Success never returns here — it redirects to Moyasar's hosted page — so the only thing this
 * renders is the refusal, which used to travel in the URL.
 */
export function PlansCheckoutForm({ children }: { children: React.ReactNode }) {
  const [state, action] = useActionState(startSubscriptionCheckout, initial);
  return (
    <form
      action={action}
      className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      {children}
      {state.error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
