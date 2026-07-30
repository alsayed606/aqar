import { Skeleton } from "@/components/ui";

// Placeholder shown by a route's loading.tsx while the server renders a list page.
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
        {Array.from({ length: rows }, (_, row) => (
          <Skeleton key={row} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
