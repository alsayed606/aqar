"use client";

import { useActionState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { FormError, useSuccessToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";
import { changePropertyOwner } from "@/app/app/properties/actions";

// Reassigning a property to a different owner. It keeps its confirmation — this moves contracts and
// money with it — and now says whether it worked without navigating away from the property.

const initial: FormState = {};

export function PropertyOwnerForm({
  propertyId,
  currentOwnerId,
  currentOwnerLabel,
  owners,
}: {
  propertyId: string;
  currentOwnerId: string;
  currentOwnerLabel: string;
  owners: { id: string; label: string }[];
}) {
  const [state, action] = useActionState(changePropertyOwner, initial);
  useSuccessToast(state);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="property_id" value={propertyId} />
      <div>
        <label className="mb-1 block text-xs text-slate-500" htmlFor="owner_id">المالك</label>
        <select
          id="owner_id"
          name="owner_id"
          defaultValue={currentOwnerId}
          className="rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-slate-700"
        >
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>
      <ConfirmButton
        message="تغيير مالك العقار قد يؤثّر على العقود والالتزامات المالية والبيانات المرتبطة به. هل تريد المتابعة؟"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        حفظ المالك
      </ConfirmButton>
      <span className="self-center text-xs text-slate-400">الحالي: {currentOwnerLabel}</span>
      <p className="w-full text-xs text-amber-600 dark:text-amber-500">
        ⚠️ تغيير المالك قد يؤثّر على العقود والالتزامات المالية المرتبطة بالعقار.
      </p>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}
