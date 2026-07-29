import type { HTMLAttributes } from "react";
import { cx } from "@/lib/cx";

// Loading placeholder. Pair with Suspense/loading.tsx boundaries when adopted.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200 dark:bg-slate-800", className)} {...props} />;
}
