"use client";

import { useActionState } from "react";
import { createInvitation, type InviteState } from "@/app/app/team/actions";
import { ROLE_AR } from "@/lib/labels";

const initial: InviteState = {};
const INVITE_ROLES = ["manager", "accountant", "staff", "viewer", "admin"];

export function InviteMemberForm() {
  const [state, action, pending] = useActionState(createInvitation, initial);

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-neutral-500" htmlFor="phone">جوال العضو</label>
          <input
            id="phone"
            name="phone"
            inputMode="tel"
            dir="ltr"
            placeholder="05XXXXXXXX"
            className="w-40 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500" htmlFor="email">أو البريد</label>
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            placeholder="name@example.com"
            className="w-48 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500" htmlFor="role">الدور</label>
          <select
            id="role"
            name="role"
            defaultValue="staff"
            className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700"
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_AR[r] ?? r}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ…" : "إنشاء دعوة"}
        </button>
      </form>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      {state.link && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-900/20">
          <p className="mb-1 font-medium text-emerald-800 dark:text-emerald-300">
            تم إنشاء الدعوة ({ROLE_AR[state.role ?? "staff"] ?? state.role}). انسخ الرابط وأرسله للعضو:
          </p>
          <p className="mb-2 text-xs text-emerald-700 dark:text-emerald-400">
            صالح ١٤ يوماً، ويُستخدم مرة واحدة. لن يظهر الرابط مرة أخرى.
          </p>
          <input
            readOnly
            value={state.link}
            dir="ltr"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-xs outline-none dark:border-emerald-800 dark:bg-neutral-900"
          />
        </div>
      )}
    </div>
  );
}
