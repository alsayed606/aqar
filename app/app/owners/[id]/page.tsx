import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { setOwnerFee, setOwnerTaxInfo, recordRemittance } from "../actions";
import { halalasToSar } from "@/lib/money";
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { first } from "@/lib/rows";
import { isoDaysAgo } from "@/lib/dates";
import { OwnerPortalInvite } from "@/components/owner-portal-invite";

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
    .select("id, is_self, iban, bank_name, vat_number, cr_number, party:party_id(display_name, national_id, phone_e164)")
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

  const party = first((owner as any).party);
  const ownerName = owner.is_self ? "المنشأة (مالك ذاتي)" : party?.display_name;
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

  return (
    <div className="space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/owners" className="hover:text-brand">الملّاك</Link> /{" "}
        <span className="text-neutral-700 dark:text-neutral-300">{ownerName}</span>
      </nav>

      {sp.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {sp.error}
        </p>
      )}

      <header className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-xl font-bold">{ownerName}</h1>
        <div className="mt-2 flex flex-wrap gap-6 text-sm text-neutral-500">
          {party?.phone_e164 && <span dir="ltr">{party.phone_e164}</span>}
          {party?.national_id && <span dir="ltr">هوية/سجل: {party.national_id}</span>}
          {owner.iban && <span dir="ltr">IBAN: {owner.iban}</span>}
          {owner.bank_name && <span>{owner.bank_name}</span>}
        </div>

        {!owner.is_self && (
          <form action={setOwnerFee} className="mt-4 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <input type="hidden" name="owner_id" value={owner.id} />
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="percent">
                نسبة أتعاب الإدارة (% من التحصيل)
              </label>
              <input
                id="percent"
                name="percent"
                inputMode="decimal"
                defaultValue={currentPct ? String(currentPct) : ""}
                placeholder="مثال: 5"
                className="w-28 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
              />
            </div>
            <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              حفظ النسبة
            </button>
            <span className="text-xs text-neutral-400">
              النسبة الحالية: {currentPct}%
            </span>
          </form>
        )}

        {!owner.is_self && (
          <form action={setOwnerTaxInfo} className="mt-4 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <input type="hidden" name="owner_id" value={owner.id} />
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="vat_number">
                الرقم الضريبي (15 رقماً)
              </label>
              <input
                id="vat_number"
                name="vat_number"
                inputMode="numeric"
                dir="ltr"
                defaultValue={(owner as any).vat_number ?? ""}
                placeholder="3XXXXXXXXXXXXX3"
                className="w-52 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="cr_number">
                السجل التجاري
              </label>
              <input
                id="cr_number"
                name="cr_number"
                dir="ltr"
                defaultValue={(owner as any).cr_number ?? ""}
                placeholder="10XXXXXXXX"
                className="w-40 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
              />
            </div>
            <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              حفظ البيانات الضريبية
            </button>
            <span className="text-xs text-neutral-400">تُستخدم كمورّد على فواتير عقارات هذا المالك.</span>
          </form>
        )}

        {!owner.is_self && (
          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <p className="mb-2 text-xs text-neutral-500">بوابة المالك — دخول ذاتي للاطّلاع على الكشوف والتوريدات</p>
            <OwnerPortalInvite ownerId={owner.id} />
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
                  <th className="px-4 py-2 text-right font-medium">العقار</th>
                  <th className="px-4 py-2 text-right font-medium">المُحصَّل (ر.س)</th>
                  <th className="px-4 py-2 text-right font-medium">الأتعاب</th>
                  <th className="px-4 py-2 text-right font-medium">الصافي للمالك</th>
                  <th className="px-4 py-2 text-right font-medium">المتبقّي على المستأجرين</th>
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
          <form
            action={recordRemittance}
            className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <input type="hidden" name="owner_id" value={owner.id} />
            <input type="hidden" name="period_from" value={from} />
            <input type="hidden" name="period_to" value={to} />
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="amount">المبلغ (ر.س)</label>
              <input
                id="amount"
                name="amount"
                inputMode="decimal"
                defaultValue={dueToOwner > 0 ? String(dueToOwner / 100) : ""}
                className="w-32 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="method">الطريقة</label>
              <select
                id="method"
                name="method"
                defaultValue="bank_transfer"
                className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700"
              >
                {Object.entries(PAYMENT_METHOD_AR).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="remitted_at">التاريخ</label>
              <input id="remitted_at" name="remitted_at" type="date" defaultValue={to}
                className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="reference">المرجع (اختياري)</label>
              <input id="reference" name="reference" dir="ltr" placeholder="رقم التحويل"
                className="w-36 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-brand dark:border-neutral-700" />
            </div>
            <button className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-fg">
              تسجيل التوريد
            </button>
          </form>

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
                    <th className="px-4 py-2 text-right font-medium">رقم السند</th>
                    <th className="px-4 py-2 text-right font-medium">التاريخ</th>
                    <th className="px-4 py-2 text-right font-medium">المبلغ (ر.س)</th>
                    <th className="px-4 py-2 text-right font-medium">الطريقة</th>
                    <th className="px-4 py-2 text-right font-medium"></th>
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
                  {p.city && <span className="mr-2 text-sm text-neutral-500">· {p.city}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
