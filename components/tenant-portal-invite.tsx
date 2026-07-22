"use client";

import { useActionState } from "react";
import { createTenantInvite, type TenantInviteState } from "@/app/app/tenants/actions";

const initial: TenantInviteState = {};

export function TenantPortalInvite({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(createTenantInvite, initial);

  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="tenant_id" value={tenantId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {pending ? "…" : "رابط البوابة"}
        </button>
      </form>

      {state.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}

      {state.link && (
        <input
          readOnly
          value={state.link}
          dir="ltr"
          onFocus={(e) => e.currentTarget.select()}
          className="w-56 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 font-mono text-[10px] outline-none dark:border-emerald-800 dark:bg-emerald-900/20"
        />
      )}
    </div>
  );
}
