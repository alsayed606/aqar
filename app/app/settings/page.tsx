import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { nationalAddressLine } from "@/lib/org-profile";
import { Card, CardBody, CardHeader, CardTitle, Button } from "@/components/ui";
import { Fact, FactGrid } from "@/components/entity-facts";
import { FilePicker } from "@/components/file-picker";
import { AccountForms } from "@/components/account-forms";
import { removeOrgLogo, updateOrgProfile, uploadOrgLogo } from "./actions";

export const dynamic = "force-dynamic";

// Only the organization actions still speak through the URL. The account forms report themselves.
const OK_AR: Record<string, string> = {
  org: "حُفظت بيانات المنشأة.",
  logo: "حُدّث الشعار.",
  logo_removed: "أُزيل الشعار.",
};

const input =
  "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

type Org = Record<string, string | null>;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const activeOrg = await getActiveOrg();
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/app/settings");

  const [{ data: orgRow }, { data: identity }, { data: membership }] = await Promise.all([
    supabase
      .from("organization")
      .select(
        "id, name, cr_number, vat_number, fal_license_no, contact_phone, contact_email, address_building_no, address_street, address_district, address_city, address_postal_code, address_additional_no, bank_name, bank_account_name, iban, logo_path, updated_at",
      )
      .eq("id", activeOrg)
      .maybeSingle(),
    supabase.from("identity").select("full_name, phone_raw, phone_e164, email").eq("id", user.id).maybeSingle(),
    supabase
      .from("membership")
      .select("role")
      .eq("org_id", activeOrg)
      .eq("identity_id", user.id)
      .maybeSingle(),
  ]);

  const org = (orgRow ?? {}) as Org;
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";
  const addressLine = nationalAddressLine(org);
  const logoSrc = org.logo_path ? `/api/org/logo?v=${encodeURIComponent(org.updated_at ?? "")}` : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">الإعدادات</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          بيانات المنشأة تظهر على المستندات التي تخرج من مكتبك. وبياناتك أنت تخصّ حسابك في كل منشأة تدخل إليها.
        </p>
      </div>

      {ok && OK_AR[ok] && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          {OK_AR[ok]}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>
      )}

      {/* ── المنشأة ──────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>بيانات المنشأة</CardTitle>
          {!isAdmin && <span className="text-xs text-slate-500">للاطّلاع فقط</span>}
        </CardHeader>
        <CardBody className="space-y-5">
          {!org.vat_number && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              <b>لا يوجد رقم ضريبي.</b> الفواتير تصدر الآن بلا هوية ضريبية للمورّد، ولا تصلح كفاتورة ضريبية مبسّطة.
              أدخله متى صدر لك — لا شيء يتوقّف قبل ذلك.
            </p>
          )}

          {isAdmin ? (
            <form action={updateOrgProfile} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="اسم المنشأة *">
                  <input name="name" required defaultValue={org.name ?? ""} className={input} />
                </Field>
                <Field label="السجل التجاري" hint="١٠ أرقام">
                  <input name="cr_number" dir="ltr" inputMode="numeric" defaultValue={org.cr_number ?? ""} className={input + " text-start"} />
                </Field>
                <Field label="الرقم الضريبي" hint="١٥ رقماً، يبدأ بـ ٣ وينتهي بـ ٣">
                  <input name="vat_number" dir="ltr" inputMode="numeric" defaultValue={org.vat_number ?? ""} className={input + " text-start"} />
                </Field>
                <Field label="رقم ترخيص فال">
                  <input name="fal_license_no" dir="ltr" inputMode="numeric" defaultValue={org.fal_license_no ?? ""} className={input + " text-start"} />
                </Field>
                <Field label="هاتف المكتب" hint="ثابت أو جوال — كما تريده مطبوعاً">
                  <input name="contact_phone" dir="ltr" defaultValue={org.contact_phone ?? ""} className={input + " text-start"} />
                </Field>
                <Field label="بريد المكتب">
                  <input name="contact_email" type="email" dir="ltr" defaultValue={org.contact_email ?? ""} className={input + " text-start"} />
                </Field>
              </div>

              <fieldset className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
                <legend className="text-sm font-semibold">العنوان الوطني</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="رقم المبنى" hint="٤ أرقام">
                    <input name="address_building_no" dir="ltr" inputMode="numeric" defaultValue={org.address_building_no ?? ""} className={input + " text-start"} />
                  </Field>
                  <Field label="الشارع">
                    <input name="address_street" defaultValue={org.address_street ?? ""} className={input} />
                  </Field>
                  <Field label="الحي">
                    <input name="address_district" defaultValue={org.address_district ?? ""} className={input} />
                  </Field>
                  <Field label="المدينة">
                    <input name="address_city" defaultValue={org.address_city ?? ""} className={input} />
                  </Field>
                  <Field label="الرمز البريدي" hint="٥ أرقام">
                    <input name="address_postal_code" dir="ltr" inputMode="numeric" defaultValue={org.address_postal_code ?? ""} className={input + " text-start"} />
                  </Field>
                  <Field label="الرقم الإضافي" hint="٤ أرقام">
                    <input name="address_additional_no" dir="ltr" inputMode="numeric" defaultValue={org.address_additional_no ?? ""} className={input + " text-start"} />
                  </Field>
                </div>
                {addressLine && (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    سيُطبع هكذا: <span className="font-medium">{addressLine}</span>
                  </p>
                )}
              </fieldset>

              <fieldset className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
                <legend className="text-sm font-semibold">الحساب البنكي للتحصيل</legend>
                <p className="text-xs text-slate-500">
                  حساب مكتبك الذي يُحوّل إليه المستأجرون. لا يُستخدم لأي تحويل يجريه النظام — النظام لا يحوّل أموالاً.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="اسم البنك">
                    <input name="bank_name" defaultValue={org.bank_name ?? ""} className={input} />
                  </Field>
                  <Field label="اسم صاحب الحساب">
                    <input name="bank_account_name" defaultValue={org.bank_account_name ?? ""} className={input} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="الآيبان" hint="يبدأ بـ SA ويتكوّن من ٢٤ خانة">
                      <input name="iban" dir="ltr" placeholder="SA0000000000000000000000" defaultValue={org.iban ?? ""} className={input + " text-start font-mono"} />
                    </Field>
                  </div>
                </div>
              </fieldset>

              <Button type="submit">حفظ بيانات المنشأة</Button>
            </form>
          ) : (
            <FactGrid>
              <Fact label="اسم المنشأة" value={org.name} />
              <Fact label="السجل التجاري" value={org.cr_number} ltr />
              <Fact label="الرقم الضريبي" value={org.vat_number} ltr />
              <Fact label="ترخيص فال" value={org.fal_license_no} ltr />
              <Fact label="هاتف المكتب" value={org.contact_phone} ltr />
              <Fact label="بريد المكتب" value={org.contact_email} ltr />
              <Fact label="العنوان الوطني" value={addressLine} />
              <Fact label="الآيبان" value={org.iban} ltr />
            </FactGrid>
          )}
        </CardBody>
      </Card>

      {/* ── الشعار ───────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>شعار المنشأة</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              {logoSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoSrc} alt="شعار المنشأة" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-slate-400">لا شعار</span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              PNG أو JPG أو WEBP، وأقل من ٥٠٠ كيلوبايت. يُحفظ في مساحة خاصّة بمنشأتك — لا يصل إليه إلا أعضاؤها.
            </p>
          </div>

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <form action={uploadOrgLogo} className="flex flex-wrap items-center gap-3">
                <FilePicker name="logo" accept="image/png,image/jpeg,image/webp" required />
                <Button type="submit" variant="outline">رفع الشعار</Button>
              </form>
              {org.logo_path && (
                <form action={removeOrgLogo}>
                  <Button type="submit" variant="ghost" className="text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">
                    إزالة
                  </Button>
                </form>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">رفع الشعار متاح للمدراء.</p>
          )}
        </CardBody>
      </Card>

      {/* ── حسابي ────────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>حسابي</CardTitle>
        </CardHeader>
        <CardBody className="space-y-6">
          {/* Three client forms: each message lands under its own field, and nothing the user typed
              is lost to a page reload. The organization card above still redirects — next step. */}
          <AccountForms
            fullName={identity?.full_name ?? ""}
            phone={identity?.phone_raw ?? identity?.phone_e164 ?? ""}
            email={user.email ?? ""}
          />
        </CardBody>
      </Card>
    </div>
  );
}
