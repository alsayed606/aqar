import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { MemberScopeForm } from "@/components/member-scope-form";
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

      <MemberScopeForm
        membershipId={member.id}
        scopeAll={member.scope_all}
        properties={properties}
        scopedIds={[...scopedIds]}
      />
    </div>
  );
}
