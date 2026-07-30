"use client";

import { useState } from "react";
import { Button, Drawer } from "@/components/ui";

export type Landlord = { id: string; label: string; national_id?: string | null };

const inp = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-neutral-700";

// Owner selector for non-owned properties: search existing landlords by name/ID, or add one inline
// (via /api/owners/quick) without leaving the page. Emits the chosen owner via a hidden `owner_id`.
export function LandlordPicker({ owners }: { owners: Landlord[] }) {
  const [list, setList] = useState<Landlord[]>(owners);
  const [selected, setSelected] = useState<Landlord | null>(null);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nn, setNn] = useState({ display_name: "", national_id: "", phone: "", legal_kind: "individual" });

  const q = query.trim();
  const matches = q
    ? list.filter((o) => o.label.includes(q) || (o.national_id ?? "").includes(q))
    : list;

  async function addOwner() {
    if (!nn.display_name.trim()) { setErr("الاسم مطلوب"); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/owners/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nn),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "تعذّر إضافة المالك"); return; }
      const created: Landlord = { id: data.id, label: data.label, national_id: data.national_id };
      setList((l) => [created, ...l]);
      setSelected(created);
      setShowAdd(false);
      setNn({ display_name: "", national_id: "", phone: "", legal_kind: "individual" });
    } catch {
      setErr("تعذّر الاتصال. حاول مجدداً.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="owner_id" value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-sm">
          <span>المالك: <span className="font-medium">{selected.label}</span></span>
          <button type="button" onClick={() => setSelected(null)} className="text-xs text-neutral-500 hover:text-brand">تغيير</button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المالك أو رقم الهوية…"
            className={inp}
          />
          {q && matches.length === 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">لم يتم العثور على بيانات. أضِف مالكاً جديداً.</p>
          )}
          {matches.length > 0 && (
            <ul className="max-h-40 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {matches.slice(0, 20).map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => setSelected(o)} className="flex w-full items-center justify-between px-3 py-1.5 text-right text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800">
                    <span>{o.label}</span>
                    {o.national_id && <span className="text-xs text-neutral-400" dir="ltr">{o.national_id}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setShowAdd(true)} className="text-xs text-brand hover:underline">
            لم تجد المالك؟ أضِف مالكاً جديداً
          </button>
        </>
      )}

      {/* Slide-over: add an owner without losing the property form behind it. Nested above the
          add-property drawer (z-[60]); on success we select the new owner and slide back. */}
      <Drawer open={showAdd} onClose={() => setShowAdd(false)} title="إضافة مالك جديد" zClass="z-[60]">
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">الاسم الكامل *</label>
            <input value={nn.display_name} onChange={(e) => setNn({ ...nn, display_name: e.target.value })} className={inp} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">النوع</label>
            <select value={nn.legal_kind} onChange={(e) => setNn({ ...nn, legal_kind: e.target.value })} className={inp}>
              <option value="individual">فرد</option>
              <option value="company">شركة</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">رقم الهوية / السجل</label>
            <input value={nn.national_id} onChange={(e) => setNn({ ...nn, national_id: e.target.value })} dir="ltr" className={inp + " text-right"} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الجوال</label>
            <input value={nn.phone} onChange={(e) => setNn({ ...nn, phone: e.target.value })} dir="ltr" placeholder="05XXXXXXXX" className={inp + " text-right"} />
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{err}</p>}
          <Button type="button" onClick={addOwner} disabled={busy} className="w-full">
            {busy ? "جارٍ الإضافة…" : "إضافة المالك واختياره"}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
