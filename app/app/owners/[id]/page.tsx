import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { setOwnerFee } from "../actions";
import { halalasToSar } from "@/lib/money";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const first = (x: any) => (Array.isArray(x) ? x[0] : x);

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

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
    .select("id, is_self, iban, bank_name, party:party_id(display_name, national_id, phone_e164)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owner) notFound();

  const [{ data: props }, { data: feeAgr }, { data: stmt, error: stmtErr }] = await Promise.all([
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
