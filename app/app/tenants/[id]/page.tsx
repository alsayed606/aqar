import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { isEstablishment } from "@/lib/tenant-identity";
import { deleteTenant } from "../actions";
import {
  TenantEditForm,
  AddTradeNameForm,
  RemoveTradeNameButton,
} from "@/components/tenant-detail-forms";
import { ConfirmButton } from "@/components/confirm-button";
import { countAr, CONTRACT_AR } from "@/lib/plural-ar";
import { ErasePartyForm } from "@/components/erase-party-form";
import { PortalInvitePanel, type InviteState } from "@/components/portal-invite-panel";
import { EntitySummary } from "@/components/entity-summary";
import { EntityNotes } from "@/components/entity-notes";
import { EntityTimeline, type TimelineEvent } from "@/components/entity-timeline";
import { halalasToSar } from "@/lib/money";
import { CONTRACT_STATUS_AR } from "@/lib/labels";
import { FormDrawer } from "@/components/form-drawer";
import { Badge } from "@/components/ui";
import { Fact, FactGrid } from "@/components/entity-facts";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const cls = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

const TYPE_AR: Record<string, string> = { individual: "فرد", sole_establishment: "مؤسسة فردية", company: "شركة" };

const PARTY_COLUMNS =
  "id, display_name, entity_type, national_id, iqama_id, passport_no, email, phone_raw, phone_e164, " +
  "cr_number, vat_number, unified_number, cr_expiry, rep_name, rep_id_number, rep_capacity, rep_phone_raw, primary_id, " +
  "id_exempt_reason, identity_complete, erased_at, erased_reason";

export default async function TenantEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error: flashError } = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");
  const caps = await getCapabilities(activeOrg);
  const canEdit = caps.has("manage_data");

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenant")
    .select(`id, tenant_type, party:party_id(${PARTY_COLUMNS})`)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!tenant) notFound();
  const p = first((tenant as any).party);

  // Brand names live under the party, and the "also represents" hint groups establishments by the
  // representative's id — the cheap answer to "one person, several commercial registrations".
  const [{ data: brands }, { data: siblings }] = await Promise.all([
    supabase.from("trade_name").select("id, name, municipal_license_no, license_expiry")
      .eq("party_id", p?.id).is("deleted_at", null).order("name"),
    p?.rep_id_number
      ? supabase.from("party").select("id, display_name").eq("rep_id_number", p.rep_id_number)
          .neq("id", p.id).is("deleted_at", null)
      : Promise.resolve({ data: null }),
  ]);

  // The 360 layer (§6.1): counts for the summary cards, and the rows the timeline is derived from.
  // Nothing here is stored — every date below is a timestamp the system already keeps.
  const [{ data: contractRows }, { data: paymentRows }, { data: noteRows }] = await Promise.all([
    supabase
      .from("contract")
      .select("id, contract_number, status, start_date, end_date, annual_rent_halalas")
      .eq("tenant_id", id)
      .is("deleted_at", null)
      .order("start_date", { ascending: false }),
    supabase
      .from("payment")
      .select("id, receipt_no, amount_halalas, received_at")
      .eq("party_id", p?.id)
      .is("deleted_at", null)
      .order("received_at", { ascending: false }),
    supabase
      .from("entity_note")
      .select("id, body, created_at, redacted_at, author:created_by(full_name)")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false }),
  ]);

  // Portal access (0074/0075): one call answers "where does this stand", and it degrades to a plain
  // "no invitation" for a database that has not had 0075 applied yet rather than breaking the page.
  const [{ data: inviteRows }, { data: orgRow }] = await Promise.all([
    supabase.rpc("portal_invitation_state", { p_party: p?.id ?? "" }),
    supabase.from("organization").select("name").eq("id", activeOrg).maybeSingle(),
  ]);
  const invite: InviteState = (first(inviteRows as any) as InviteState | undefined) ?? {
    state: "none", sent_at: null, sent_channel: null, sent_to: null,
    opened_at: null, expires_at: null, linked: false,
  };

  const contracts = (contractRows ?? []) as any[];
  const payments = (paymentRows ?? []) as any[];
  const activeContracts = contracts.filter((c) => c.status === "active");
  const paidTotal = payments.reduce((sum, x) => sum + Number(x.amount_halalas ?? 0), 0);

  const notes = (noteRows ?? []).map((n: any) => ({
    id: n.id,
    body: n.body,
    created_at: n.created_at,
    redacted_at: n.redacted_at,
    author: first(n.author)?.full_name ?? null,
  }));

  // Derived, not recorded. A stored event log would be a second copy of these same facts.
  const timeline: TimelineEvent[] = [
    ...contracts.flatMap((c) => [
      { at: c.start_date, label: `بدأ العقد ${c.contract_number}`, detail: CONTRACT_STATUS_AR[c.status] ?? c.status, href: `/app/contracts/${c.id}` },
      { at: c.end_date, label: `ينتهي العقد ${c.contract_number}`, href: `/app/contracts/${c.id}` },
    ]),
    ...payments.map((x) => ({
      at: String(x.received_at ?? "").slice(0, 10),
      label: `سند قبض ${x.receipt_no ?? ""}`.trim(),
      detail: `${halalasToSar(x.amount_halalas)} ر.س`,
      href: `/app/receipts/${x.id}`,
    })),
    ...notes.map((n) => ({ at: String(n.created_at).slice(0, 10), label: "ملاحظة داخلية", detail: n.author })),
  ];

  const establishment = isEstablishment(p?.entity_type ?? (tenant as any).tenant_type ?? "individual");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/tenants" className="hover:text-brand">المستأجرون</Link> /{" "}
        <span className="text-neutral-700 dark:text-neutral-300">{p?.display_name}</span>
      </nav>

      {/* Every form on this page answers for itself now. This banner is left for one thing only:
          archiving the tenant, which goes through the shared archiveRecord and refuses with the
          contracts it found — a statement about the record, not about a field. */}
      {ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">{ok === "1" ? "حُفظت التعديلات." : ok}</p>}
      {flashError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{flashError}</p>}

      {p?.identity_complete === false && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          بيانات ناقصة — هذا السجل أُنشئ قبل قاعدة المعرّف الرئيسي. أكمِل{" "}
          {establishment ? "الرقم الموحّد وبيانات الممثل" : "رقم الهوية أو الإقامة أو الجواز"} متى أمكن.
        </p>
      )}

      {siblings && siblings.length > 0 && (
        <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-900/20 dark:text-sky-300">
          الممثل نفسه مسجّل على {siblings.length} منشأة أخرى:{" "}
          {siblings.map((s: any, i: number) => (
            <span key={s.id}>
              {i > 0 && "، "}
              <Link href={`/app/tenants?q=${encodeURIComponent(s.display_name)}`} className="underline">{s.display_name}</Link>
            </span>
          ))}
        </div>
      )}

      {/* Every card hands off to the module that owns the number, filtered to this tenant. */}
      <EntitySummary
        stats={[
          { label: "العقود", value: contracts.length, href: `/app/contracts?tenant=${tenant.id}` },
          { label: "عقود نشطة", value: activeContracts.length, href: `/app/contracts?tenant=${tenant.id}` },
          { label: "سندات القبض", value: payments.length, href: `/app/receipts?party=${p?.id}` },
          { label: "إجمالي المقبوض (ر.س)", value: halalasToSar(paidTotal), href: `/app/receipts?party=${p?.id}` },
        ]}
      />

      {/* §6.1 header: the record stated as facts, with editing behind a control. An always-open
          form put 730px of inputs between the summary and the notes, so the page read as a form
          that happened to have a summary on top rather than as a record of this tenant. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{p?.display_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone="brand">{TYPE_AR[p?.entity_type ?? (tenant as any).tenant_type] ?? "—"}</Badge>
              {p?.identity_complete === false && <Badge tone="warning">بيانات ناقصة</Badge>}
              {p?.erased_at && <Badge tone="neutral">بيانات محذوفة</Badge>}
            </div>
          </div>

          {canEdit && !p?.erased_at && (
            <FormDrawer
              label="تعديل البيانات"
              title={`تعديل — ${p?.display_name ?? "المستأجر"}`}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
              }
            >
              <TenantEditForm
                tenantId={tenant.id}
                partyId={p?.id ?? ""}
                defaults={{
                    display_name: p?.display_name ?? "",
                    tenant_type: p?.entity_type ?? (tenant as any).tenant_type ?? "individual",
                    phone: p?.phone_raw ?? p?.phone_e164 ?? "",
                    email: p?.email ?? "",
                    national_id: p?.national_id ?? "",
                    iqama_id: p?.iqama_id ?? "",
                    passport_no: p?.passport_no ?? "",
                    unified_number: p?.unified_number ?? "",
                    cr_number: p?.cr_number ?? "",
                    vat_number: p?.vat_number ?? "",
                    cr_expiry: p?.cr_expiry ?? "",
                    rep_name: p?.rep_name ?? "",
                    rep_id_number: p?.rep_id_number ?? "",
                    rep_capacity: p?.rep_capacity ?? "",
                    rep_phone: p?.rep_phone_raw ?? "",
                  id_exempt_reason: p?.id_exempt_reason ?? "",
                }}
              />
            </FormDrawer>
          )}
        </div>

        <FactGrid>
          <Fact label={establishment ? "الرقم الموحّد" : "المعرّف الرئيسي"} value={p?.primary_id} ltr />
          <Fact label="الجوال" value={p?.phone_raw ?? p?.phone_e164} ltr />
          <Fact label="البريد الإلكتروني" value={p?.email} ltr />
          {establishment && <Fact label="السجل التجاري" value={p?.cr_number} ltr />}
          {establishment && <Fact label="الرقم الضريبي" value={p?.vat_number} ltr />}
          {establishment && <Fact label="ممثل المنشأة" value={p?.rep_name} />}
          {establishment && <Fact label="هوية الممثل" value={p?.rep_id_number} ltr />}
          {establishment && <Fact label="جوال الممثل" value={p?.rep_phone_raw} ltr />}
        </FactGrid>

        {!canEdit && (
          <p className="mt-3 text-xs text-slate-500">
            التعديل متاح لمن يملك صلاحية إدارة البيانات.
          </p>
        )}

        {/* Below the facts, not above them. Delete belongs after the record it acts on — put
            between the name and the data it reads as a status banner about the tenant. Matches
            where the owner page keeps the same control. */}
        {canEdit && !p?.erased_at && (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            {contracts.length === 0 ? (
              <form action={deleteTenant}>
                <input type="hidden" name="tenant_id" value={tenant.id} />
                <ConfirmButton
                  message={`حذف «${p?.display_name}»؟ يبقى سجلّه محفوظاً ويمكن الرجوع إليه.`}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  حذف المستأجر
                </ConfirmButton>
              </form>
            ) : (
              <p className="text-xs text-slate-500">
                لا يُحذف هذا المستأجر — عليه {countAr(contracts.length, CONTRACT_AR)}.{" "}
                <Link href={`/app/contracts?tenant=${tenant.id}`} className="text-brand hover:underline">
                  عرض العقود ←
                </Link>
              </p>
            )}
          </div>
        )}
      </section>

      {/* One registration, several brand names — each under its own municipal licence. */}
      {establishment && (
        <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold">الأسماء التجارية</h2>
          <p className="text-sm text-neutral-500">
            الأسماء التي تعمل تحت هذا السجل. يختار العقد اسماً منها، ويحتفظ بنسخته وقت التوقيع.
          </p>

          {(brands ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
              لا توجد أسماء تجارية بعد.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {(brands ?? []).map((b: any) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-xs text-neutral-500">
                      {b.municipal_license_no ? `رخصة ${b.municipal_license_no}` : "بدون رقم رخصة"}
                      {b.license_expiry ? ` — تنتهي ${b.license_expiry}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <RemoveTradeNameButton tenantId={tenant.id} tradeNameId={b.id} />
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <AddTradeNameForm tenantId={tenant.id} partyId={p?.id ?? ""} />
          )}
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <div>
          <h2 className="text-lg font-semibold">بوابة المستأجر</h2>
          <p className="mt-1 text-sm text-slate-500">
            يطّلع المستأجر على عقده ودفعاته، ويقدّم طلبات الصيانة. ولا يُقبل الرابط إلا من الحساب الذي أُرسل إليه.
          </p>
        </div>
        <PortalInvitePanel
          partyId={p?.id ?? ""}
          orgName={orgRow?.name ?? "المكتب"}
          invite={invite}
          canManage={canEdit}
        />
      </section>

      {/* PDPL erasure (0061). The office is the controller for this person's data, so the request
          is executed here rather than by us. Hidden once already erased — there is nothing left. */}
      {canEdit && !p?.erased_at && (
        <section className="space-y-3 rounded-2xl border border-red-300 bg-white p-6 shadow-sm dark:border-red-900 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">حذف البيانات الشخصية</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            عند طلب صاحب البيانات: يُحذف الاسم والهوية والجوال والبريد وبيانات الممثل نهائياً، ويبقى العقد بشروطه
            المالية و<b>الفواتير الضريبية</b> لأن الأنظمة تُلزم بحفظها. لا يمكن التراجع.
          </p>
          <ErasePartyForm tenantId={tenant.id} partyId={p?.id ?? ""} />
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <EntityNotes target="tenant" entityId={tenant.id} notes={notes} canWrite={canEdit} />
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">الخط الزمني</h2>
        <EntityTimeline events={timeline} />
      </section>

      {p?.erased_at && (
        <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          حُذفت البيانات الشخصية لهذا السجل بتاريخ {new Date(p.erased_at).toLocaleDateString("ar-SA")}.
          {p.erased_reason ? ` السبب: ${p.erased_reason}.` : ""}
        </p>
      )}
    </div>
  );
}
