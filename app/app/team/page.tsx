import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { InviteMemberForm } from "@/components/invite-member-form";
import { MemberRoleForm, MemberStatusButton, RevokeInviteButton } from "@/components/team-row-actions";
import { ROLE_AR, MEMBER_STATUS_AR, MEMBER_STATUS_TONE } from "@/lib/labels";

export const dynamic = "force-dynamic";

const ROLE_OPTIONS = ["owner", "admin", "manager", "accountant", "staff", "viewer"];

type Member = {
  membership_id: string;
  identity_id: string;
  phone_e164: string | null;
  role: string;
  status: string;
  scope_all: boolean;
};

type Invite = {
  id: string;
  phone_e164: string | null;
  email: string | null;
  role: string;
  expires_at: string;
};

export default async function TeamPage() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: self } = await supabase
    .from("membership")
    .select("role, status")
    .eq("org_id", activeOrg)
    .eq("identity_id", user?.id ?? "")
    .maybeSingle();

  const isAdmin = self?.role === "owner" || self?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">الفريق</h1>
        <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          أنت عضو في هذه المنشأة بصفة <span className="font-medium">{ROLE_AR[self?.role ?? ""] ?? "عضو"}</span>.
          إدارة الأعضاء والدعوات متاحة للمدراء فقط.
        </p>
      </div>
    );
  }

  const [{ data: memberData }, { data: inviteData }] = await Promise.all([
    supabase.rpc("org_members"),
    supabase
      .from("invitation")
      .select("id, phone_e164, email, role, expires_at")
      .eq("org_id", activeOrg)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const members = (memberData ?? []) as Member[];
  const invites = (inviteData ?? []) as Invite[];
  const now = Date.now();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">الفريق والصلاحيات</h1>

      {/* No page banner: the invite form answers under its own fields, and each row action answers
          in a toast beside the button that was pressed. */}

      {/* Invite */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 text-base font-semibold">دعوة عضو</h2>
        <InviteMemberForm />
      </section>

      {/* Members */}
      <section>
        <h2 className="mb-3 text-base font-semibold">الأعضاء ({members.length})</h2>
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 text-right font-medium">الجوال</th>
                <th className="px-4 py-2 text-right font-medium">الدور</th>
                <th className="px-4 py-2 text-right font-medium">النطاق</th>
                <th className="px-4 py-2 text-right font-medium">الحالة</th>
                <th className="px-4 py-2 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {members.map((m) => {
                const isSelf = m.identity_id === user?.id;
                return (
                  <tr key={m.membership_id}>
                    <td className="px-4 py-2" dir="ltr">
                      {m.phone_e164 ?? "—"}
                      {isSelf && <span className="mr-2 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">أنت</span>}
                    </td>
                    <td className="px-4 py-2">
                      {isSelf ? (
                        <span className="font-medium">{ROLE_AR[m.role] ?? m.role}</span>
                      ) : (
                        <MemberRoleForm
                          membershipId={m.membership_id}
                          role={m.role}
                          roles={ROLE_OPTIONS}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/app/team/${m.membership_id}/scope`}
                        className="text-xs text-brand hover:underline"
                      >
                        {m.scope_all ? "كل العقارات" : "عقارات محدّدة"}
                        <span className="mr-1 text-neutral-400">· تحديد</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className={"rounded-full px-2.5 py-0.5 text-xs font-medium " + (MEMBER_STATUS_TONE[m.status] ?? "")}>
                        {MEMBER_STATUS_AR[m.status] ?? m.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {isSelf ? (
                        <span className="text-xs text-neutral-400">—</span>
                      ) : (
                        <MemberStatusButton membershipId={m.membership_id} status={m.status} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Role reference — what each role can do (enforced at the database via RLS). */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 text-base font-semibold">صلاحيات الأدوار</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-neutral-500">
              <tr className="[&>th]:py-1.5 [&>th]:text-right [&>th]:font-medium">
                <th>الدور</th>
                <th>ما الذي يستطيعه</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {[
                ["المالك / المدير العام", "كل شيء: البيانات، المالية، الفريق، والاشتراك/الدفع."],
                ["مدير المكتب", "البيانات (عقارات/عقود/مستأجرون/ملّاك) + المالية (سندات/فواتير) — بلا فريق أو فوترة."],
                ["المحاسب", "العمليات المالية فقط (سندات القبض، الفواتير، التوريدات) + الاطّلاع."],
                ["مدخل البيانات", "إدخال وتعديل البيانات (العقارات/الوحدات/المستأجرون/العقود) — بلا عمليات مالية."],
                ["مطّلع", "قراءة فقط، دون أي تعديل."],
              ].map(([role, desc]) => (
                <tr key={role} className="[&>td]:py-2 [&>td]:align-top">
                  <td className="whitespace-nowrap font-medium">{role}</td>
                  <td className="text-neutral-600 dark:text-neutral-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending invitations */}
      <section>
        <h2 className="mb-3 text-base font-semibold">دعوات معلّقة ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
            لا توجد دعوات معلّقة.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2 text-right font-medium">المدعو</th>
                  <th className="px-4 py-2 text-right font-medium">الدور</th>
                  <th className="px-4 py-2 text-right font-medium">تنتهي</th>
                  <th className="px-4 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {invites.map((inv) => {
                  const expired = new Date(inv.expires_at).getTime() < now;
                  return (
                    <tr key={inv.id}>
                      <td className="px-4 py-2" dir="ltr">{inv.phone_e164 || inv.email || "—"}</td>
                      <td className="px-4 py-2">{ROLE_AR[inv.role] ?? inv.role}</td>
                      <td className="px-4 py-2">
                        <span dir="ltr">{new Date(inv.expires_at).toISOString().slice(0, 10)}</span>
                        {expired && <span className="mr-2 text-xs text-red-600 dark:text-red-400">منتهية</span>}
                      </td>
                      <td className="px-4 py-2">
                        <RevokeInviteButton invitationId={inv.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
