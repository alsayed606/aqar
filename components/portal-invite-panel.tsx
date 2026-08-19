"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { useSuccessToast } from "@/components/form-field";
import {
  sendPortalInvite,
  revokePortalInvite,
  unlinkPortalAccount,
} from "@/app/app/tenants/portal-actions";
import type { FormState } from "@/lib/form-state";

// Where the office's portal invitation stands, and what can still be done about it.
//
// Before 0075 this was a button that produced a link into a box. The office then had no way to know
// whether it arrived, whether it was opened, or whether it still pointed at an address the tenant
// uses — so the honest thing to show was nothing, and nothing is what it showed.

export type InviteState = {
  state: string;
  sent_at: string | null;
  sent_channel: string | null;
  sent_to: string | null;
  /** The provider's id for the message it accepted (0077) — evidence, not proof of arrival. */
  sent_message_id: string | null;
  opened_at: string | null;
  expires_at: string | null;
  linked: boolean;
};

const STATE_AR: Record<string, string> = {
  none: "لم تُرسَل دعوة",
  pending: "أُنشئت ولم تُرسَل",
  sent: "أُرسلت",
  opened: "فُتح الرابط",
  accepted: "قُبلت",
  linked: "الحساب مرتبط",
  revoked: "أُلغيت",
  superseded: "استُبدلت",
  expired: "انتهت صلاحيتها",
};

// What each state means for the office's next move — the sentence that turns a label into a decision.
const STATE_HINT: Record<string, string> = {
  none: "أرسِل الدعوة ليطّلع المستأجر على عقده ودفعاته ويقدّم طلبات الصيانة.",
  pending: "الرمز موجود ولم تخرج رسالة. اضغط «إرسال» ليصل.",
  // Deliberately not "وصلت": what we know is that the provider took the message, and telling the
  // office more than we know is what turns "لم يصلني شيء" into an argument nobody can settle.
  sent: "سلّمنا الرسالة لمزوّد البريد وقبِلها. ننتظر أن يفتحها المستأجر.",
  opened: "فُتح الرابط ولم يكتمل الربط بعد — قد يكون سجّل الدخول ببريد آخر.",
  accepted: "قُبلت الدعوة.",
  linked: "يستطيع المستأجر الدخول إلى بوابته الآن.",
  revoked: "أُلغيت الدعوة، والرابط القديم لم يعد يعمل.",
  superseded: "تغيّر بريد المستأجر أو جواله بعد الإرسال، فأُبطل الرابط تلقائياً. أرسِل دعوة جديدة.",
  expired: "مضى على الدعوة أكثر من ٣٠ يوماً. أرسِل دعوة جديدة.",
};

const STATE_TONE: Record<string, "neutral" | "success" | "warning" | "info" | "danger"> = {
  none: "neutral",
  pending: "warning",
  sent: "info",
  opened: "info",
  accepted: "success",
  linked: "success",
  revoked: "neutral",
  superseded: "warning",
  expired: "warning",
};

const initial: FormState = {};
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

function SendForm({ partyId, orgName, label }: { partyId: string; orgName: string; label: string }) {
  const [state, action, pending] = useActionState(sendPortalInvite, initial);
  useSuccessToast(state);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="party_id" value={partyId} />
      <input type="hidden" name="org_name" value={orgName} />
      <button
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-fg disabled:opacity-60"
      >
        {pending ? "جارٍ الإرسال…" : label}
      </button>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}

function RevokeForm({ partyId }: { partyId: string }) {
  const [state, action, pending] = useActionState(revokePortalInvite, initial);
  useSuccessToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="party_id" value={partyId} />
      <ConfirmButton
        message="إلغاء الدعوة؟ الرابط المُرسَل لن يعمل بعدها."
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "…" : "إلغاء الدعوة"}
      </ConfirmButton>
      {state.error && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{state.error}</p>}
    </form>
  );
}

function UnlinkForm({ partyId }: { partyId: string }) {
  const [state, action, pending] = useActionState(unlinkPortalAccount, initial);
  useSuccessToast(state);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="party_id" value={partyId} />
      <div>
        <input
          name="reason"
          placeholder="سبب فكّ الارتباط (مطلوب)"
          aria-label="سبب فكّ الارتباط"
          defaultValue={state.values?.reason ?? ""}
          className={
            "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none " +
            (state.field === "reason"
              ? "border-red-400 dark:border-red-500"
              : "border-slate-300 focus:border-brand dark:border-slate-700")
          }
        />
        {state.error && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{state.error}</p>
        )}
      </div>
      {/* The reason is not paperwork: this is how a profile changes hands, and the audit log keeps it. */}
      <ConfirmButton
        message="فكّ ارتباط الحساب؟ لن يستطيع الدخول إلى البوابة حتى تُرسل دعوة جديدة."
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
      >
        {pending ? "…" : "فكّ ارتباط الحساب"}
      </ConfirmButton>
    </form>
  );
}

export function PortalInvitePanel({
  partyId,
  orgName,
  invite,
  canManage,
  hasEmail,
}: {
  partyId: string;
  orgName: string;
  invite: InviteState;
  canManage: boolean;
  /** The invitation is sent to the record's email and accepted only from it (0074). */
  hasEmail: boolean;
}) {
  const { state } = invite;
  const sentDay = day(invite.sent_at);
  const openedDay = day(invite.opened_at);
  const expiresDay = day(invite.expires_at);
  // A live invitation is one that can still be accepted — the only case where withdrawing it means
  // anything.
  const isLive = state === "pending" || state === "sent" || state === "opened";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATE_TONE[state] ?? "neutral"}>{STATE_AR[state] ?? state}</Badge>
        {sentDay && (
          <span className="text-xs text-slate-500">
            أُرسلت <span dir="ltr">{sentDay}</span>
            {invite.sent_to && <> إلى <span dir="ltr">{invite.sent_to}</span></>}
          </span>
        )}
        {openedDay && <span className="text-xs text-slate-500">· فُتحت <span dir="ltr">{openedDay}</span></span>}
        {isLive && expiresDay && <span className="text-xs text-slate-500">· تنتهي <span dir="ltr">{expiresDay}</span></span>}
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400">{STATE_HINT[state] ?? ""}</p>

      {canManage && invite.sent_message_id && (
        // Folded away: it matters on the one day the tenant says nothing arrived, and is noise on
        // every other day.
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">لم تصل الرسالة؟</summary>
          <p className="mt-1">
            معرّف الرسالة لدى مزوّد البريد:{" "}
            <span dir="ltr" className="font-mono select-all">{invite.sent_message_id}</span>
          </p>
          <p className="mt-1">
            ابحث عنه في سجلّ المزوّد ليقول لك: سُلّمت، أم ارتدّت، أم صُنّفت مزعجة. ونحن لا نرى ذلك من
            هنا — نعرف فقط أنه قبِلها.
          </p>
        </details>
      )}

      {canManage && (
        <div className="flex flex-wrap items-start gap-3">
          {invite.linked ? (
            <UnlinkForm partyId={partyId} />
          ) : !hasEmail ? (
            // Offering the button here would be worse than useless: issuing a new invitation retires
            // the live one first, so a click would kill the existing link and send nothing.
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              لا يوجد بريد إلكتروني لهذا السجل. أضِفه من «تعديل البيانات» — الدعوة تُرسَل إليه، ولا تُقبل إلا منه.
            </p>
          ) : (
            <>
              <SendForm
                partyId={partyId}
                orgName={orgName}
                label={isLive ? "إعادة الإرسال" : "إرسال الدعوة"}
              />
              {isLive && <RevokeForm partyId={partyId} />}
            </>
          )}
        </div>
      )}

      {canManage && !invite.linked && isLive && (
        // Said once, here, because it is the surprising half of the rule: the office may expect a
        // resend to add a second link rather than replace the first.
        <p className="text-xs text-slate-500">إعادة الإرسال تُبطل الرابط السابق وتُصدر رابطاً جديداً.</p>
      )}
    </div>
  );
}
