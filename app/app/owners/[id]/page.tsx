import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { deleteOwner } from "../actions";
import { OwnerFeeForm, OwnerTaxForm, RemittanceForm } from "@/components/owner-detail-forms";
import { ConfirmButton } from "@/components/confirm-button";
import { countAr, PROPERTY_AR } from "@/lib/plural-ar";
import { halalasToSar } from "@/lib/money";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { first } from "@/lib/rows";
import { EntityNotes } from "@/components/entity-notes";
import { Fact, FactGrid } from "@/components/entity-facts";
import { FormDrawer } from "@/components/form-drawer";
import { Badge } from "@/components/ui";
import { EntityTimeline, type TimelineEvent } from "@/components/entity-timeline";
import { isoDaysAgo } from "@/lib/dates";
import { PortalInvitePanel, type InviteState } from "@/components/portal-invite-panel";
import { getCapabilities } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type StmtRow = {
  property_id: string;
  property_name: string;
  collected_halalas: number;
  outstanding_halalas: number;
  fee_halalas: number;
  net_halalas: number;
};

export default async function OwnerDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const from = sp.from || isoDaysAgo(90);
  const to = sp.to || isoDaysAgo(0);

  const supabase = await createClient();

  const { data: owner } = await supabase
    .from("owner")
    .select("id, is_self, iban, bank_name, vat_number, cr_number, party:party_id(id, display_name, national_id, phone_e164, email)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owner) notFound();

  const [{ data: props }, { data: feeAgr }, { data: stmt, error: stmtErr }, { data: remitData }] =
    await Promise.all([
      supabase.from("property").select("id, name, city").eq("owner_id", id).is("deleted_at", null).order("name"),
      supabase
        .from("management_agreement")
        .select("fee_percentage")
        .eq("owner_id", id)
        .eq("fee_model", "percentage_of_collection")
        .is("deleted_at", null)
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("owner_statement", { p_owner: id, p_from: from, p_to: to }),
      supabase
        .from("owner_remittance")
        .select("id, remittance_no, amount_halalas, method, remitted_at, period_from, period_to, reference")
        .eq("owner_id", id)
        .is("deleted_at", null)
        .order("remitted_at", { ascending: false })
        .limit(100),
    ]);

  const { data: noteRows } = await supabase
    .from("entity_note")
    .select("id, body, created_at, redacted_at, author:created_by(full_name)")
    .eq("owner_id", id)
    .order("created_at", { ascending: false });
  const notes = (noteRows ?? []).map((n: any) => ({
    id: n.id, body: n.body, created_at: n.created_at, redacted_at: n.redacted_at,
    author: first(n.author)?.full_name ?? null,
  }));

  const party = first((owner as any).party);
  const ownerName = owner.is_self ? "المنشأة (مالك ذاتي)" : party?.display_name;

  // Portal access (0074/0075). Asked only when there is a panel to fill: the self-owner is the
  // office itself and never gets one, and an id-less party would send "" to a uuid argument — a
  // guaranteed failure on every visit, swallowed, to populate something nobody renders.
  const caps = await getCapabilities(activeOrg);
  const canEdit = caps.has("manage_data");
  const noInvite: InviteState = {
    state: "none", sent_at: null, sent_channel: null, sent_to: null, sent_message_id: null,
    opened_at: null, expires_at: null, linked: false,
  };
  let invite = noInvite;
  if (!owner.is_self && party?.id) {
    // Degrades to "no invitation" rather than breaking the page: this call is new here, and an
    // older database is a state the office should be able to look at, not a crash.
    const { data: inviteRows } = await supabase.rpc("portal_invitation_state", { p_party: party.id });
    invite = (first(inviteRows as any) as InviteState | undefined) ?? noInvite;
  }
  const currentPct = feeAgr?.fee_percentage != null ? Number(feeAgr.fee_percentage) * 100 : 0;
  const rows = (stmt ?? []) as StmtRow[];

  const tot = rows.reduce(
    (s, r) => ({
      collected: s.collected + Number(r.collected_halalas),
      fee: s.fee + Number(r.fee_halalas),
      net: s.net + Number(r.net_halalas),
      outstanding: s.outstanding + Number(r.outstanding_halalas),
    }),
    { collected: 0, fee: 0, net: 0, outstanding: 0 },
  );

  type Remit = {
    id: string;
    remittance_no: string | null;
    amount_halalas: number;
    method: string;
    remitted_at: string;
    period_from: string | null;
    period_to: string | null;
    reference: string | null;
  };
  const remittances = (remitData ?? []) as Remit[];
  const periodRemitted = remittances
    .filter((r) => {
      const d = new Date(r.remitted_at).toISOString().slice(0, 10);
      return d >= from && d <= to;
    })
    .reduce((s, r) => s + Number(r.amount_halalas), 0);
  const dueToOwner = tot.net - periodRemitted;

  // Derived from timestamps already stored on the remittances and the notes — no event table.
  const timeline: TimelineEvent[] = [
    ...remittances.map((r) => ({
      at: String(r.remitted_at).slice(0, 10),
      label: `توريد ${r.remittance_no ?? ""}`.trim(),
      detail: `${halalasToSar(r.amount_halalas)} ر.س`,
      href: `/app/owners/${id}/remittance/${r.id}`,
    })),
    ...notes.map((n) => ({ at: String(n.created_at).slice(0, 10), label: "ملاحظة داخلية", detail: n.author })),
  ];

  return (
    <div className="space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/owners" className="hover:text-brand">الملّاك</Link> /{" "}
        <span className="text-neutral-700 dark:text-neutral-300">{ownerName}</span>
      </nav>

      {/* The three forms on this page answer under their own fields now. This banner stays for the
          one action that still speaks through the URL: archiving the owner, which is handled by the
          shared archiveRecord and refuses with the dependants it found. */}
      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {sp.error}
        </p>
      )}

      {/* §6.1 header: what this owner IS, with the settings that change behaviour behind a
          control. Two always-open forms in the header made the page open on configuration rather
          than on the owner. */}
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{ownerName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={owner.is_self ? "brand" : "neutral"}>{owner.is_self ? "مالك ذاتي" : "مالك خارجي"}</Badge>
              {!owner.is_self && !(owner as any).vat_number && <Badge tone="warning">بلا رقم ضريبي</Badge>}
            </div>
          </div>

          {!owner.is_self && (
            <FormDrawer
              label="تعديل البيانات"
              title={`تعديل — ${ownerName}`}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
              }
            >
              <div className="space-y-6">
        {!owner.is_self && <OwnerFeeForm ownerId={owner.id} currentPct={currentPct} />}
        {!owner.is_self && (
          <OwnerTaxForm
            ownerId={owner.id}
            vatNumber={(owner as any).vat_number ?? ""}
            crNumber={(owner as any).cr_number ?? ""}
          />
        )}

        {/* The same panel the tenant screen uses. It was written against a PARTY, not a tenant, so
            the owner side needed no second version of it — only a caller. And the lifecycle behind
            it (0074/0075) always covered owner_portal; it was this page that kept knocking on the
            old door from 0028. */}
        {!owner.is_self && (
          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <p className="mb-2 text-xs text-neutral-500">بوابة المالك — دخول ذاتي للاطّلاع على الكشوف والتوريدات</p>
            <PortalInvitePanel
              partyId={party?.id ?? ""}
              invite={invite}
              canManage={canEdit}
              hasEmail={!!party?.email}
            />
          </div>
        )}
              </div>
            </FormDrawer>
          )}
        </div>

        <FactGrid>
          <Fact label="الجوال" value={party?.phone_e164} ltr />
          <Fact label="الهوية / السجل" value={party?.national_id} ltr />
          <Fact label="الآيبان" value={owner.iban} ltr />
          <Fact label="البنك" value={owner.bank_name} />
          {!owner.is_self && <Fact label="نسبة أتعاب الإدارة" value={currentPct ? `${currentPct}%` : null} />}
          {!owner.is_self && <Fact label="الرقم الضريبي" value={(owner as any).vat_number} ltr />}
          {!owner.is_self && <Fact label="السجل التجاري" value={(owner as any).cr_number} ltr />}
        </FactGrid>

        {/* The self-owner has no delete control at all — not a disabled one. It is the office
            itself, and issue_invoice reads its tax identity for every owned property; a button
            that can only ever refuse teaches nothing. */}
        {!owner.is_self && (
          <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            {(props ?? []).length === 0 ? (
              <form action={deleteOwner}>
                <input type="hidden" name="owner_id" value={owner.id} />
                <ConfirmButton
                  message={`حذف المالك «${ownerName}»؟ يبقى سجلّه محفوظاً ويمكن الرجوع إليه.`}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  حذف المالك
                </ConfirmButton>
              </form>
            ) : (
              <p className="text-xs text-neutral-500">
                لا يُحذف هذا المالك — له {countAr((props ?? []).length, PROPERTY_AR)}. انقل ملكيتها
                إلى مالك آخر أوّلاً من صفحة كل عقار.
              </p>
            )}
          </div>
        )}
      </header>

      {/* Statement */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">كشف الحساب</h2>
          <form method="get" className="flex items-end gap-2">
            <div>
              <label className="mb-0.5 block text-xs text-neutral-500" htmlFor="from">من</label>
              <input id="from" name="from" type="date" defaultValue={from}
                className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-neutral-700" />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-neutral-500" htmlFor="to">إلى</label>
              <input id="to" name="to" type="date" defaultValue={to}
                className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-neutral-700" />
            </div>
            <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              عرض
            </button>
          </form>
          <Link
            href={`/app/owners/${owner.id}/statement?from=${from}&to=${to}`}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-fg"
          >
            كشف حساب قابل للطباعة ←
          </Link>
        </div>

        {stmtErr ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            {/owner_statement/i.test(stmtErr.message)
              ? "دالة كشف الحساب غير مطبّقة بعد على القاعدة (هجرة 0020)."
              : stmtErr.message}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">العقار</th>
                  <th className="px-4 py-2 text-start font-medium">المُحصَّل (ر.س)</th>
                  <th className="px-4 py-2 text-start font-medium">الأتعاب</th>
                  <th className="px-4 py-2 text-start font-medium">الصافي للمالك</th>
                  <th className="px-4 py-2 text-start font-medium">المتبقّي على المستأجرين</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                      لا توجد عقارات لهذا المالك في هذه الفترة.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.property_id}>
                      <td className="px-4 py-2 font-medium">{r.property_name}</td>
                      <td className="px-4 py-2">{halalasToSar(r.collected_halalas)}</td>
                      <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{halalasToSar(r.fee_halalas)}</td>
                      <td className="px-4 py-2 font-medium text-emerald-700 dark:text-emerald-400">{halalasToSar(r.net_halalas)}</td>
                      <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{halalasToSar(r.outstanding_halalas)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-neutral-50 font-semibold dark:bg-neutral-900">
                  <tr>
                    <td className="px-4 py-2">الإجمالي</td>
                    <td className="px-4 py-2">{halalasToSar(tot.collected)}</td>
                    <td className="px-4 py-2">{halalasToSar(tot.fee)}</td>
                    <td className="px-4 py-2 text-emerald-700 dark:text-emerald-400">{halalasToSar(tot.net)}</td>
                    <td className="px-4 py-2">{halalasToSar(tot.outstanding)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>

      {/* Remittance to owner */}
      {!owner.is_self && (
        <section>
          <h2 className="mb-3 text-base font-semibold">التوريد للمالك</h2>

          {/* Period summary: net vs remitted vs remaining */}
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-neutral-200 bg-white p-3 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-neutral-500">صافي الفترة (ر.س)</p>
              <p className="mt-1 text-lg font-bold">{halalasToSar(tot.net)}</p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white p-3 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-neutral-500">المورّد في الفترة</p>
              <p className="mt-1 text-lg font-bold">{halalasToSar(periodRemitted)}</p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white p-3 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-neutral-500">المتبقّي للمالك</p>
              <p className={`mt-1 text-lg font-bold ${dueToOwner > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                {halalasToSar(dueToOwner)}
              </p>
            </div>
          </div>

          {/* Record a remittance */}
          <RemittanceForm
            ownerId={owner.id}
            periodFrom={from}
            periodTo={to}
            suggestedAmount={dueToOwner > 0 ? String(dueToOwner / 100) : ""}
            methods={Object.entries(PAYMENT_METHOD_AR).map(([value, label]) => ({ value, label }))}
          />

          {/* History */}
          {remittances.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
              لا توجد عمليات توريد بعد.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">رقم السند</th>
                    <th className="px-4 py-2 text-start font-medium">التاريخ</th>
                    <th className="px-4 py-2 text-start font-medium">المبلغ (ر.س)</th>
                    <th className="px-4 py-2 text-start font-medium">الطريقة</th>
                    <th className="px-4 py-2 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {remittances.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-mono font-medium" dir="ltr">{r.remittance_no ?? "—"}</td>
                      <td className="px-4 py-2" dir="ltr">{new Date(r.remitted_at).toISOString().slice(0, 10)}</td>
                      <td className="px-4 py-2 font-medium">{halalasToSar(r.amount_halalas)}</td>
                      <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{PAYMENT_METHOD_AR[r.method] ?? r.method}</td>
                      <td className="px-4 py-2">
                        <Link href={`/app/owners/${owner.id}/remittance/${r.id}`} className="text-brand hover:underline">
                          سند الصرف ←
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Properties */}
      <section>
        <h2 className="mb-3 text-base font-semibold">عقارات المالك</h2>
        {(props ?? []).length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-neutral-500 dark:border-neutral-700">
            لا توجد عقارات مرتبطة بهذا المالك. اربط عقاراً من صفحة العقار.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {(props ?? []).map((p: any) => (
              <li key={p.id}>
                <Link href={`/app/properties/${p.id}`} className="block rounded-xl border border-neutral-200 px-4 py-3 hover:border-brand dark:border-neutral-800">
                  <span className="font-medium">{p.name}</span>
                  {p.city && <span className="ms-2 text-sm text-neutral-500">· {p.city}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <EntityNotes target="owner" entityId={owner.id} notes={notes} canWrite={true} />
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">الخط الزمني</h2>
        <EntityTimeline events={timeline} />
      </section>

    </div>
  );
}
