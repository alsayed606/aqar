"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTenant, type TenantState } from "@/app/app/tenants/actions";
import { useFormDrawerClose } from "@/components/form-drawer";
import { useToast } from "@/components/ui";
import { TenantFields } from "@/components/tenant-fields";

const initial: TenantState = {};

export function TenantForm() {
  const [state, action, pending] = useActionState(createTenant, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const closeDrawer = useFormDrawerClose();
  const { toast } = useToast();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      closeDrawer?.();
      toast({ title: "تمت إضافة المستأجر", tone: "success" });
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <TenantFields />

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {pending ? "جارٍ الحفظ…" : "إضافة المستأجر"}
      </button>
    </form>
  );
}
