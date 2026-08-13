"use client";

import { useActionState } from "react";
import { useResultToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { revokeInvitation, setMemberRole, setMemberStatus } from "@/app/app/team/actions";
import { ROLE_AR } from "@/lib/labels";

// One button on one row. There is no field for a message to sit under and nothing typed to lose, so
// these speak in toasts — near the pointer, gone when read, and they do not shove the table down the
// page. The rule is the same one the settings page follows: the message appears where the action was.

const initial: FormState = {};
const cellButton =
  "rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800";

export function MemberRoleForm({
  membershipId,
  role,
  roles,
}: {
  membershipId: string;
  role: string;
  roles: string[];
}) {
  const [state, action, pending] = useActionState(setMemberRole, initial);
  useResultToast(state);

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="membership_id" value={membershipId} />
      <select
        name="role"
        defaultValue={role}
        aria-label="دور العضو"
        className="rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-xs outline-none dark:border-neutral-700"
      >
        {roles.map((r) => (
          <option key={r} value={r}>{ROLE_AR[r] ?? r}</option>
        ))}
      </select>
      <button disabled={pending} className={cellButton}>
        {pending ? "…" : "حفظ"}
      </button>
    </form>
  );
}

export function MemberStatusButton({
  membershipId,
  status,
}: {
  membershipId: string;
  status: string;
}) {
  const [state, action, pending] = useActionState(setMemberStatus, initial);
  useResultToast(state);
  const active = status === "active";

  return (
    <form action={action}>
      <input type="hidden" name="membership_id" value={membershipId} />
      <input type="hidden" name="status" value={active ? "suspended" : "active"} />
      <button disabled={pending} className={cellButton}>
        {pending ? "…" : active ? "إيقاف" : "تفعيل"}
      </button>
    </form>
  );
}

export function RevokeInviteButton({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState(revokeInvitation, initial);
  useResultToast(state);

  return (
    <form action={action}>
      <input type="hidden" name="invitation_id" value={invitationId} />
      <button disabled={pending} className={cellButton}>
        {pending ? "…" : "إلغاء"}
      </button>
    </form>
  );
}
