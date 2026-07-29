"use client";

import { useState } from "react";
import { updateUnit } from "@/app/app/properties/actions";
import { UNIT_STATUS_AR } from "@/lib/labels";
import { Button, Drawer } from "@/components/ui";

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

// Quick-edit a unit in a right-sliding drawer instead of an inline expander. updateUnit redirects
// back to /app/units, so a successful save reloads the page (drawer gone, list fresh).
export function UnitEditDrawer({ unit }: { unit: Unit }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-brand">
        تعديل
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`تعديل الوحدة ${unit.unit_number}`}>
        <form action={updateUnit} className="grid gap-3">
          <input type="hidden" name="unit_id" value={unit.id} />
          <input type="hidden" name="back" value="/app/units" />
          <div>
            <label className="mb-1 block text-sm font-medium">رقم الوحدة *</label>
            <input name="unit_number" defaultValue={unit.unit_number} required className={fieldCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الحالة</label>
            <select name="current_status" defaultValue={unit.current_status} className={fieldCls}>
              {Object.entries(UNIT_STATUS_AR).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">الدور</label>
              <input name="floor" defaultValue={unit.floor ?? ""} className={fieldCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">المساحة (م²)</label>
              <input name="area_sqm" defaultValue={unit.area_sqm ?? ""} inputMode="decimal" className={fieldCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">غرف النوم</label>
              <input name="bedrooms" defaultValue={unit.bedrooms ?? ""} inputMode="numeric" className={fieldCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">دورات المياه</label>
              <input name="bathrooms" defaultValue={unit.bathrooms ?? ""} inputMode="numeric" className={fieldCls} />
            </div>
          </div>
          <div className="pt-2">
            <Button type="submit" className="w-full">حفظ التعديل</Button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
