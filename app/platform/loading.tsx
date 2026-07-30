import { Skeleton } from "@/components/ui";

// Streamed while the platform RPCs run. The shape mirrors the dashboard so the page does not jump
// when the real numbers land.
export default function PlatformLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-6 w-48" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ))}
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </div>
  );
}
