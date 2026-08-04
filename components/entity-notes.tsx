"use client";

import { useActionState, useEffect, useRef } from "react";
import { addEntityNote, type NoteState, type NoteTarget } from "@/app/app/actions";
import { Button, useToast } from "@/components/ui";

export type EntityNote = {
  id: string;
  body: string;
  created_at: string;
  redacted_at: string | null;
  author: string | null;
};

const initial: NoteState = {};

/**
 * Internal notes on a persistent entity (§6.1). Append-only and authored: what an office wrote is
 * what stays there. There is deliberately no edit or delete control — the database refuses both, so
 * offering a button would only be a lie the UI tells.
 *
 * One component for tenants, owners and properties; the design system is explicit that this is
 * implemented once rather than copied per module.
 */
export function EntityNotes({
  target,
  entityId,
  notes,
  canWrite,
}: {
  target: NoteTarget;
  entityId: string;
  notes: EntityNote[];
  canWrite: boolean;
}) {
  const [state, action, pending] = useActionState(addEntityNote, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      toast({ title: "أُضيفت الملاحظة", tone: "success" });
    }
  }, [state.ok]);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">ملاحظات داخلية</h2>
        <span className="text-xs text-slate-500">لا تظهر للمالك ولا للمستأجر</span>
      </div>

      {canWrite && (
        <form ref={formRef} action={action} className="space-y-2">
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="entity_id" value={entityId} />
          <textarea
            name="body"
            rows={2}
            required
            placeholder="ما الذي حدث أو تقرّر؟"
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending} variant="outline">
              {pending ? "جارٍ الحفظ…" : "إضافة ملاحظة"}
            </Button>
            <span className="text-xs text-slate-500">الملاحظة لا تُعدَّل ولا تُحذف بعد حفظها.</span>
          </div>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {state.error}
            </p>
          )}
        </form>
      )}

      {notes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
          لا توجد ملاحظات بعد.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              {note.redacted_at ? (
                <p className="text-sm italic text-slate-500">{note.body}</p>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{note.body}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {note.author ?? "—"} · <span dir="ltr">{note.created_at.slice(0, 16).replace("T", " ")}</span>
                {note.redacted_at && " · حُذف محتواها بطلب صاحب البيانات"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
