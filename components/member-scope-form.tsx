"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FormError } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { setMemberScope } from "@/app/app/team/actions";

// Which properties a member may see. A refusal used to bounce the admin to /app/team carrying the
// message in the URL — away from the checkboxes, and with the whole selection rebuilt from the
// stored row. Now it stays here, and what was ticked stays ticked.

const initial: FormState = {};

export function MemberScopeForm({
  membershipId,
  scopeAll,
  properties,
  scopedIds,
}: {
  membershipId: string;
  scopeAll: boolean;
  properties: { id: string; name: string; city: string | null }[];
  scopedIds: string[];
}) {
  const [state, action, pending] = useActionState(setMemberScope, initial);
  const scoped = new Set(scopedIds);

  return (
    <form action={action} className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <input type="hidden" name="membership_id" value={membershipId} />

      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="radio" name="scope_all" value="true" defaultChecked={scopeAll} />
          <span className="text-sm font-medium">كل عقارات المنشأة</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="scope_all" value="false" defaultChecked={!scopeAll} />
          <span className="text-sm font-medium">عقارات محدّدة فقط</span>
        </label>
      </div>

      <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
        <p className="mb-2 text-xs text-neutral-500">
          اختر العقارات (تُطبَّق فقط عند اختيار «عقارات محدّدة»). إن لم تختر شيئاً، لن يرى العضو أي عقار.
        </p>
        {properties.length === 0 ? (
          <p className="text-sm text-neutral-500">لا توجد عقارات في المنشأة بعد.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {properties.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
              >
                <input type="checkbox" name="property_ids" value={p.id} defaultChecked={scoped.has(p.id)} />
                <span className="font-medium">{p.name}</span>
                {p.city && <span className="text-xs text-neutral-500">· {p.city}</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      <FormError state={state} />

      <div className="flex gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ النطاق"}
        </button>
        <Link
          href="/app/team"
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          رجوع
        </Link>
      </div>
    </form>
  );
}
