import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * The five steps that turn an empty account into a working office, and where each one stands.
 *
 * Every step is DERIVED from the data, never stored: a checklist with its own table drifts the first
 * time someone adds a property by import, or deletes the only contract. Asking the tables costs four
 * head-counts and can never be wrong.
 *
 * It disappears the moment the last step is done. A permanent banner congratulating a working office
 * is clutter, and the office reads it as a page element rather than a task.
 */

type Step = {
  title: string;
  hint: string;
  href: string;
  cta: string;
  done: boolean;
};

async function readSteps(activeOrg: string): Promise<Step[]> {
  const supabase = await createClient();
  const count = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).is("deleted_at", null);

  const [units, contracts, members] = await Promise.all([
    count("unit"),
    count("contract"),
    // Memberships carry no deleted_at: the office removes a member by revoking, not by deleting.
    supabase.from("membership").select("id", { count: "exact", head: true }).eq("org_id", activeOrg),
  ]);

  const hasUnits = (units.count ?? 0) > 0;
  const hasContracts = (contracts.count ?? 0) > 0;
  // The founder is a member too, so "invited someone" means more than one.
  const hasTeam = (members.count ?? 0) > 1;

  return [
    {
      title: "إنشاء الحساب والمنشأة",
      hint: "تمّ عند تسجيلك.",
      href: "/app/settings",
      cta: "بيانات المنشأة",
      done: true,
    },
    {
      title: "إضافة أول عقار ووحدة",
      hint: "العقار وعاء، والوحدة هي ما يُؤجَّر فعلاً.",
      href: "/app/properties",
      cta: "أضِف عقاراً",
      done: hasUnits,
    },
    {
      title: "إضافة أول مستأجر وعقد",
      hint: "تفعيل العقد يولّد جدول الاستحقاقات تلقائياً.",
      href: "/app/contracts",
      cta: "أنشئ عقداً",
      done: hasContracts,
    },
    {
      title: "دعوة أعضاء الفريق",
      hint: "لكل عضو دور، ويمكن حصره بعقارات معيّنة.",
      href: "/app/team",
      cta: "ادعُ عضواً",
      done: hasTeam,
    },
    {
      // Not a task the office performs — it is what the first four make possible. It completes with
      // them, so the list ends on the screen the office should be reading from then on.
      title: "مراجعة لوحة المؤشرات",
      hint: "التحصيل والمتأخرات والإشغال في مكان واحد.",
      href: "/app",
      cta: "أنت هنا",
      done: hasUnits && hasContracts && hasTeam,
    },
  ];
}

function Mark({ done, number }: { done: boolean; number: number }) {
  if (done) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs text-white">
        <span aria-hidden>✓</span>
        <span className="sr-only">مكتملة</span>
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-xs font-bold text-slate-500 dark:border-slate-600">
      {number}
    </span>
  );
}

export async function SetupChecklist({ activeOrg }: { activeOrg: string }) {
  const steps = await readSteps(activeOrg);
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  // The first unfinished step is the only one offering a button: five calls to action at once is a
  // menu, not a next step.
  const nextIndex = steps.findIndex((s) => !s.done);
  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <section className="rounded-2xl border border-brand/25 bg-white p-5 shadow-sm dark:border-brand/30 dark:bg-slate-900">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold">إكمال الإعداد</h2>
        <span className="text-xs font-bold text-brand">{doneCount} / {steps.length}</span>
      </div>

      <div
        className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label="تقدّم إعداد المنشأة"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>

      <ol className="space-y-3">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li key={step.title} className="flex items-start gap-2.5">
              <Mark done={step.done} number={index + 1} />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    "text-sm " +
                    (step.done
                      ? "text-slate-500 line-through decoration-slate-300"
                      : isNext
                        ? "font-bold text-slate-900 dark:text-white"
                        : "text-slate-400")
                  }
                >
                  {step.title}
                </p>
                {isNext && (
                  <>
                    <p className="mt-0.5 text-xs text-slate-500">{step.hint}</p>
                    <Link
                      href={step.href}
                      className="mt-1.5 inline-block rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-fg"
                    >
                      {step.cta} ←
                    </Link>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
