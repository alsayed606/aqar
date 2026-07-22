import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { InviteMemberForm } from "@/components/invite-member-form";
import { revokeInvitation, setMemberRole, setMemberStatus } from "./actions";
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

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: flashError } = await searchParams;
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

      {flashError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {flashError}
        </p>
      )}

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
                        <form action={setMemberRole} className="flex items-center gap-1">
                          <input type="hidden" name="membership_id" value={m.membership_id} />
                          <select
                            name="role"
                            defaultValue={m.role}
                            className="rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-xs outline-none dark:border-neutral-700"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>{ROLE_AR[r] ?? r}</option>
                            ))}
                          </select>
                          <button className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                            حفظ
                          </button>
                        </form>
                      )}
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
                        <form action={setMemberStatus}>
                          <input type="hidden" name="membership_id" value={m.membership_id} />
                          <input
                            type="hidden"
                            name="status"
                            value={m.status === "active" ? "suspended" : "active"}
                          />
                          <button className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                            {m.status === "active" ? "إيقاف" : "تفعيل"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
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
                        <form action={revokeInvitation}>
                          <input type="hidden" name="invitation_id" value={inv.id} />
                          <button className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                            إلغاء
                          </button>
                        </form>
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
