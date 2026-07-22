import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { setMemberScope } from "../../actions";
import { ROLE_AR } from "@/lib/labels";

export const dynamic = "force-dynamic";

type Property = { id: string; name: string; city: string | null };

export default async function MemberScopePage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const { membershipId } = await params;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only admins manage scopes.
  const { data: self } = await supabase
    .from("membership")
    .select("role")
    .eq("org_id", activeOrg)
    .eq("identity_id", user?.id ?? "")
    .maybeSingle();
  if (self?.role !== "owner" && self?.role !== "admin") redirect("/app/team");

  const { data: member } = await supabase
    .from("membership")
    .select("id, role, scope_all, identity_id")
    .eq("id", membershipId)
    .eq("org_id", activeOrg)
    .maybeSingle();
  if (!member) notFound();

  const [{ data: propsData }, { data: scopeData }] = await Promise.all([
    supabase.from("property").select("id, name, city").is("deleted_at", null).order("name"),
    supabase.from("membership_property_scope").select("property_id").eq("membership_id", membershipId),
  ]);

  const properties = (propsData ?? []) as Property[];
  const scopedIds = new Set((scopeData ?? []).map((r: { property_id: string }) => r.property_id));

  return (
    <div className="space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/team" className="hover:text-brand">الفريق</Link> /{" "}
        <span className="text-neutral-700 dark:text-neutral-300">صلاحيات عضو</span>
      </nav>

      <header>
        <h1 className="text-xl font-bold">نطاق العقارات للعضو</h1>
        <p className="mt-1 text-sm text-neutral-500">
          الدور: {ROLE_AR[member.role] ?? member.role}. حدّد ما إذا كان العضو يرى كل العقارات أو عقارات محدّدة فقط.
        </p>
      </header>

      <form action={setMemberScope} className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <input type="hidden" name="membership_id" value={member.id} />

        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope_all" value="true" defaultChecked={member.scope_all} className="peer" />
            <span className="text-sm font-medium">كل عقارات المنشأة</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope_all" value="false" defaultChecked={!member.scope_all} />
            <span className="text-sm font-medium">عقارات محدّدة فقط</span>
          </label>
        </div>

        <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <p className="mb-2 text-xs text-neutral-500">
            اختر العقارات (تُطبَّق فقط عند اختيار «عقارات محدّدة»). إن لم تختر شيئاً، لن يرى العضو أي عقار.
          </p>
          {properties.length === 0 ? (
            <p className="text-sm text-neutral-500">لا توجد عقارات في المنشأة بعد.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {properties.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
                >
                  <input type="checkbox" name="property_ids" value={p.id} defaultChecked={scopedIds.has(p.id)} />
                  <span className="font-medium">{p.name}</span>
                  {p.city && <span className="text-xs text-neutral-500">· {p.city}</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg">
            حفظ النطاق
          </button>
          <Link href="/app/team" className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
            رجوع
          </Link>
        </div>
      </form>
    </div>
  );
}
