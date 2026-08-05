import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { archiveErrorAr } from "@/lib/archive-errors";

/**
 * Archive a record: set deleted_at, keep the row and its history. Used by the property, unit,
 * tenant and owner delete actions, which differ only in the table and where they return to.
 *
 * Three things every caller needs, and none of them had before:
 *
 *   * the 0067 guard's refusal, translated — "مرتبط بوحدتين وعقد واحد", not a Postgres string;
 *   * `.select("id")`, because an UPDATE that RLS filters down to zero rows is NOT an error. It
 *     reports success having changed nothing, and the office is told a record is gone when it is
 *     still there — the same silent no-op that org-profile editing had;
 *   * `is("deleted_at", null)`, so archiving something already archived is caught as such rather
 *     than counted as a second success.
 *
 * Returns only when the row was really archived; every other path redirects with a reason.
 */
export async function archiveRecord(
  table: "property" | "unit" | "tenant" | "owner",
  id: string,
  back: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from(table)
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id ?? null,
      deleted_reason: "office_archive",
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");

  if (error) redirect(`${back}?error=${encodeURIComponent(archiveErrorAr(error.message))}`);
  if (!data || data.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("لم يُحذف شيء — إمّا أنه محذوف مسبقاً أو أن صلاحيتك لا تسمح.")}`);
  }
}
