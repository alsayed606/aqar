"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Drawer } from "@/components/ui";

// Lets a form inside the drawer close it on success. Optional: forms used outside a drawer get null.
const CloseCtx = createContext<(() => void) | null>(null);
export function useFormDrawerClose() {
  return useContext(CloseCtx);
}

// A prominent "+ add" button that opens the given form in a right-sliding drawer, decluttering the
// list surfaces. Auto-opens when the URL carries ?add=1 (so the sidebar quick-add (+) can trigger it).
export function FormDrawer({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();

  useEffect(() => {
    if (sp.get("add") === "1") setOpen(true);
  }, [sp]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label}
      </Button>
      <Drawer open={open} onClose={close} title={title}>
        <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
      </Drawer>
    </>
  );
}
