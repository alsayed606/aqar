"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
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
  icon,
}: {
  label: string;
  title: string;
  children: ReactNode;
  /** Defaults to a plus. Pass a different glyph when the drawer edits rather than adds — a plus on
   *  an "تعديل" button tells the user they are about to create something. */
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const consumedAddParam = useRef(false);

  // Open once on arrival. Without the ref this re-fires whenever the route refreshes (a successful
  // create calls revalidatePath), re-opening the drawer right after the form closed it.
  useEffect(() => {
    if (!consumedAddParam.current && searchParams.get("add") === "1") {
      consumedAddParam.current = true;
      setOpen(true);
    }
  }, [searchParams]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        {icon ?? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
        {label}
      </Button>
      <Drawer open={open} onClose={close} title={title}>
        <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
      </Drawer>
    </>
  );
}
