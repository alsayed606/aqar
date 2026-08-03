import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { first } from "@/lib/rows";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { getCapabilities } from "@/lib/capabilities";
import { TenantFields } from "@/components/tenant-fields";
import { isEstablishment } from "@/lib/tenant-identity";
import { updateTenant, addTradeName, removeTradeName } from "../actions";
import { erasePartyData } from "../../privacy/actions";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const cls = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

const TYPE_AR: Record<string, string> = { individual: "فرد", sole_establishment: "مؤسسة فردية", company: "شركة" };

const PARTY_COLUMNS =
  "id, display_name, entity_type, national_id, iqama_id, passport_no, email, phone_raw, phone_e164, " +
  "cr_number, vat_number, unified_number, cr_expiry, rep_name, rep_id_number, rep_capacity, rep_phone_raw, " +
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

  const establishment = isEstablishment(p?.entity_type ?? (tenant as any).tenant_type ?? "individual");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-sm text-neutral-500">
        <Link href="/app/tenants" className="hover:text-brand">المستأجرون</Link> /{" "}
        <span className="text-neutral-700 dark:text-neutral-300">{p?.display_name}</span>
      </nav>

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

      {!canEdit ? (
        <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          تعديل المستأجرين متاح لمن يملك صلاحية إدارة البيانات. النوع الحالي: {TYPE_AR[(tenant as any).tenant_type] ?? "—"}.
        </p>
      ) : (
        <form action={updateTenant} className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <input type="hidden" name="tenant_id" value={tenant.id} />
          <input type="hidden" name="party_id" value={p?.id} />
          <h1 className="text-lg font-semibold">تعديل المستأجر</h1>

          <TenantFields
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

          <button className="rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg">حفظ التعديلات</button>
        </form>
      )}

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
                    <form action={removeTradeName}>
                      <input type="hidden" name="tenant_id" value={tenant.id} />
                      <input type="hidden" name="trade_name_id" value={b.id} />
                      <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                        إزالة
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <form action={addTradeName} className="grid gap-3 border-t border-neutral-100 pt-3 sm:grid-cols-3 dark:border-neutral-800">
              <input type="hidden" name="tenant_id" value={tenant.id} />
              <input type="hidden" name="party_id" value={p?.id} />
              <input name="name" required placeholder="الاسم التجاري (مثال: مخابز الريان)" className={cls + " sm:col-span-3"} />
              <input name="municipal_license_no" dir="ltr" placeholder="رقم رخصة البلدية" className={cls + " text-right"} />
              <input name="license_expiry" type="date" dir="ltr" className={cls} />
              <button className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-fg">إضافة</button>
            </form>
          )}
        </section>
      )}

      {/* PDPL erasure (0061). The office is the controller for this person's data, so the request
          is executed here rather than by us. Hidden once already erased — there is nothing left. */}
      {canEdit && !p?.erased_at && (
        <section className="space-y-3 rounded-2xl border border-red-300 bg-white p-6 shadow-sm dark:border-red-900 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">حذف البيانات الشخصية</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            عند طلب صاحب البيانات: يُحذف الاسم والهوية والجوال والبريد وبيانات الممثل نهائياً، ويبقى العقد بشروطه
            المالية و<b>الفواتير الضريبية</b> لأن الأنظمة تُلزم بحفظها. لا يمكن التراجع.
          </p>
          <form action={erasePartyData} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="party_id" value={p?.id} />
            <input name="reason" placeholder="سبب الطلب (اختياري)" className={cls + " sm:col-span-2"} />
            <input name="confirm" required autoComplete="off" placeholder="اكتب: حذف" className={cls} />
            <button className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 sm:col-span-3 sm:w-auto sm:justify-self-start">
              حذف البيانات الشخصية
            </button>
          </form>
        </section>
      )}

      {p?.erased_at && (
        <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          حُذفت البيانات الشخصية لهذا السجل بتاريخ {new Date(p.erased_at).toLocaleDateString("ar-SA")}.
          {p.erased_reason ? ` السبب: ${p.erased_reason}.` : ""}
        </p>
      )}
    </div>
  );
}
