import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { nationalAddressLine } from "@/lib/org-profile";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { Fact, FactGrid } from "@/components/entity-facts";
import { AccountForms } from "@/components/account-forms";
import { OrgProfileForm, OrgLogoForms } from "@/components/org-profile-form";

export const dynamic = "force-dynamic";

type Org = Record<string, string | null>;

export default async function SettingsPage() {
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

      {/* No page-wide banner any more: every form on this page now answers under its own field, and
          success is a toast. Nothing here reports itself through the URL. */}

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
            <OrgProfileForm org={org} addressLine={addressLine} />
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
            <OrgLogoForms hasLogo={Boolean(org.logo_path)} />
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
