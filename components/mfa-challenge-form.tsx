"use client";

import { useActionState } from "react";
import { verifyChallenge, abandonChallenge, type ChallengeState } from "@/app/auth/mfa/actions";

const initial: ChallengeState = {};

export function MfaChallengeForm({ returnTo }: { returnTo: string }) {
  const [state, action, pending] = useActionState(verifyChallenge, initial);

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          required
          dir="ltr"
          placeholder="000000"
          aria-label="رمز التحقّق"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-brand dark:border-neutral-700"
        />

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ التحقّق…" : "تأكيد"}
        </button>
      </form>

      {/* The only way out. Without it, a user without their authenticator to hand is stuck on a
          page whose every other control refuses them. */}
      <form action={abandonChallenge}>
        <button className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          تسجيل الخروج
        </button>
      </form>
    </div>
  );
}
