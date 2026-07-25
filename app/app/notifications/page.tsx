import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { markAllRead } from "./actions";

export const dynamic = "force-dynamic";

type Note = {
  id: string;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string | null;
  due_date: string | null;
  read_at: string | null;
  created_at: string;
};

const KIND: Record<string, { label: string; tone: string }> = {
  charge_due_soon: { label: "استحقاق قريب", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  charge_overdue: { label: "متأخر", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  contract_expiring: { label: "عقد ينتهي", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
};

export default async function NotificationsPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  // Refresh, then list (both no-op/empty before migration 0034 is applied).
  await supabase.rpc("generate_notifications", { p_org: activeOrg });
  // Queue email deliveries for any unread notifications (idempotent; no-op before 0038). The Vercel
  // Cron drainer sends them. Degrades silently if the function isn't there yet.
  await supabase.rpc("enqueue_email_deliveries", { p_org: activeOrg });
  const { data, error } = await supabase
    .from("notification")
    .select("id, kind, entity_type, entity_id, title, body, due_date, read_at, created_at")
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(50);

  const notes = (data ?? []) as Note[];
  const hasUnread = notes.some((n) => !n.read_at);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الإشعارات</h1>
        {hasUnread && (
          <form action={markAllRead}>
            <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              تعليم الكل كمقروء
            </button>
          </form>
        )}
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        تنبيهات تشغيلية للمكتب: الاستحقاقات القريبة والمتأخرة، والعقود التي تنتهي قريباً. (تُعرض داخل التطبيق؛ التذكير عبر SMS/واتساب لاحقاً.)
      </p>

      {error ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          لتفعيل الإشعارات، طبّق هجرة <span dir="ltr">0034</span> على قاعدة البيانات.
        </p>
      ) : notes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          لا توجد تنبيهات حالياً. 👍
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const k = KIND[n.kind] ?? { label: n.kind, tone: "bg-neutral-100 text-neutral-700" };
            const href =
              n.entity_type === "contract" && n.entity_id ? `/app/contracts/${n.entity_id}` : null;
            const inner = (
              <div
                className={
                  "flex items-start justify-between gap-3 rounded-2xl border p-4 " +
                  (n.read_at
                    ? "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                    : "border-brand/30 bg-brand/5 dark:border-brand/40")
                }
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />}
                    <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + k.tone}>{k.label}</span>
                    <span className="truncate font-medium">{n.title}</span>
                  </div>
                  {n.body && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{n.body}</p>}
                </div>
                {href && <span className="shrink-0 text-sm text-brand">عرض ←</span>}
              </div>
            );
            return (
              <li key={n.id}>{href ? <Link href={href} className="block">{inner}</Link> : inner}</li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
