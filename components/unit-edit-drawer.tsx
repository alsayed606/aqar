"use client";

import { useActionState, useEffect, useState } from "react";
import { updateUnit, deleteUnit } from "@/app/app/properties/actions";
import { UNIT_STATUS_AR } from "@/lib/labels";
import { Button, Drawer } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { FormError, useSuccessToast } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

type Unit = {
  id: string;
  unit_number: string;
  current_status: string;
  floor: string | null;
  area_sqm: number | string | null;
  bedrooms: number | string | null;
  bathrooms: number | string | null;
};

const fieldCls =
  "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700";

const initial: FormState = {};

// Quick-edit a unit in a right-sliding drawer instead of an inline expander.
//
// The save used to redirect to /app/units, which closed the drawer whatever the outcome — including
// the one that matters, a duplicate unit number, which arrived as a banner on the page behind and
// took the edit with it. Now the drawer holds its ground on a refusal and closes on success.
export function UnitEditDrawer({ unit }: { unit: Unit }) {
  const [open, setOpen] = useState(false);
  const [state, save, saving] = useActionState(updateUnit, initial);
  useSuccessToast(state);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  const shown = (name: keyof Unit, fallback: string | number | null) =>
    state.values?.[name] ?? (fallback ?? "");
  const badField = (name: string) =>
    state.field === name ? fieldCls.replace("border-slate-300", "border-red-400") : fieldCls;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-brand">
        تعديل
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`تعديل الوحدة ${unit.unit_number}`}>
        <form action={save} className="grid gap-3">
          <input type="hidden" name="unit_id" value={unit.id} />
          <div>
            <label className="mb-1 block text-sm font-medium">رقم الوحدة *</label>
            <input
              name="unit_number"
              defaultValue={shown("unit_number", unit.unit_number)}
              required
              className={badField("unit_number")}
            />
            {state.field === "unit_number" && state.error && (
              <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الحالة</label>
            <select
              name="current_status"
              defaultValue={shown("current_status", unit.current_status)}
              className={fieldCls}
            >
              {Object.entries(UNIT_STATUS_AR).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">الدور</label>
              <input name="floor" defaultValue={shown("floor", unit.floor)} className={fieldCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">المساحة (م²)</label>
              <input name="area_sqm" defaultValue={shown("area_sqm", unit.area_sqm)} inputMode="decimal" className={fieldCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">غرف النوم</label>
              <input name="bedrooms" defaultValue={shown("bedrooms", unit.bedrooms)} inputMode="numeric" className={fieldCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">دورات المياه</label>
              <input name="bathrooms" defaultValue={shown("bathrooms", unit.bathrooms)} inputMode="numeric" className={fieldCls} />
            </div>
          </div>
          <FormError state={state} />
          <div className="pt-2">
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "جارٍ الحفظ…" : "حفظ التعديل"}
            </Button>
          </div>
        </form>

        {/* A sibling of the edit form, never nested inside it — a form within a form does not
            submit. The refusal, when the unit still carries a contract, comes from the database
            and arrives as a readable sentence on the page behind. */}
        <form action={deleteUnit} className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <input type="hidden" name="unit_id" value={unit.id} />
          <input type="hidden" name="back" value="/app/units" />
          <p className="mb-2 text-xs text-slate-500">
            الحذف يُخفي الوحدة من القوائم ويُبقي سجلّها. ولا يتمّ ما دام عليها عقد.
          </p>
          <ConfirmButton
            message={`حذف الوحدة ${unit.unit_number}؟ يبقى سجلّها محفوظاً.`}
            className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            حذف الوحدة
          </ConfirmButton>
        </form>
      </Drawer>
    </>
  );
}
