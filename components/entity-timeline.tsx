import Link from "next/link";

export type TimelineEvent = {
  at: string;
  label: string;
  detail?: string | null;
  href?: string;
};

/**
 * The derived timeline of a 360 page (§6.1).
 *
 * Every entry is read from a timestamp the system already stores — a contract's start, a payment's
 * date, a note's creation. Nothing here is written anywhere: an events table would be a second
 * record of the same facts, free to disagree with the first.
 */
export function EntityTimeline({ events, limit = 12 }: { events: TimelineEvent[]; limit?: number }) {
  const dated = [...events].filter((e) => e.at);
  const today = new Date().toISOString().slice(0, 10);

  // A contract's end date is a real event, but it has not happened yet. Sorting everything by date
  // put "ينتهي العقد" above events that already occurred, so the page read as though the lease had
  // already ended. Upcoming dates are separated and labelled instead of being mixed into history.
  const upcoming = dated.filter((e) => e.at > today).sort((a, b) => (a.at > b.at ? 1 : -1));
  const past = dated.filter((e) => e.at <= today).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);

  if (dated.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
        لا توجد أحداث مسجّلة بعد.
      </p>
    );
  }

  const group = (items: TimelineEvent[], future: boolean) => (
    <ol className="relative space-y-3 border-s border-slate-200 ps-4 dark:border-slate-800">
      {items.map((event, i) => (
        <li key={`${event.at}-${i}`} className="relative">
          {/* A hollow dot for what has not happened yet, filled for what has — the two groups stay
              distinguishable without relying on colour alone. */}
          <span
            className={
              "absolute -start-[1.30rem] top-1.5 h-2 w-2 rounded-full " +
              (future ? "border border-brand bg-transparent" : "bg-brand")
            }
          />
          <div className="text-sm text-slate-800 dark:text-slate-200">
            {event.href ? (
              <Link href={event.href} className="hover:text-brand hover:underline">{event.label}</Link>
            ) : (
              event.label
            )}
          </div>
          <div className="text-xs text-slate-500">
            <span dir="ltr">{event.at.slice(0, 10)}</span>
            {event.detail && ` · ${event.detail}`}
          </div>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">قادم</p>
          {group(upcoming, true)}
        </div>
      )}
      {past.length > 0 && (
        <div className="space-y-2">
          {upcoming.length > 0 && <p className="text-xs font-medium text-slate-500">ما حدث</p>}
          {group(past, false)}
        </div>
      )}
    </div>
  );
}
