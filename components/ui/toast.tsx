"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

type Tone = "success" | "error" | "info";
type ToastItem = { id: number; title: string; tone: Tone };
type ToastApi = { toast: (t: { title: string; tone?: Tone }) => void };

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within <ToastProvider>");
  return c;
}

const TONES: Record<Tone, string> = {
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-slate-900 text-white dark:bg-slate-700",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback(({ title, tone = "info" }: { title: string; tone?: Tone }) => {
    const id = ++idRef.current;
    setItems((xs) => [...xs, { id, title, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx("pointer-events-auto animate-slide-in-up rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg", TONES[t.tone])}
          >
            {t.title}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
