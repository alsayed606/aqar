import { foldDigits } from "@/lib/num";
import { isValidIban } from "@/lib/iban";

/**
 * The organization's own identity: what gets printed on its documents and, for the tax fields, what
 * app.issue_invoice copies onto every invoice as the supplier.
 *
 * The checks here mirror the constraints in migration 0066 one for one. The database is the real
 * gate; this layer exists so the office reads "الرقم الضريبي يتكوّن من ١٥ رقماً" instead of a
 * Postgres constraint name. The one thing it checks that the database cannot is the IBAN checksum.
 */

export type OrgProfileValues = Record<string, string | null>;
/** `field` names the input the refusal belongs under — see lib/form-state.ts for why that matters. */
export type OrgProfileResult = { values: OrgProfileValues; error?: string; field?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Digits, spaces, dashes and a single leading +. Deliberately looser than app.normalize_phone_e164:
// an office prints a landline (011…) at least as often as a mobile, and E.164 would reject it.
const PHONE_RE = /^\+?[0-9][0-9\s-]{6,19}$/;

/** Strip the spaces banks print IBANs with, and fold Arabic-Indic digits, before storing. */
export function normalizeIban(input: string): string {
  return foldDigits(input).toUpperCase().replace(/\s+/g, "");
}

export function parseOrgProfile(formData: FormData): OrgProfileResult {
  const text = (key: string) => String(formData.get(key) ?? "").trim() || null;
  const digits = (key: string) => {
    const raw = text(key);
    return raw === null ? null : foldDigits(raw).replace(/[\s-]/g, "");
  };

  const name = text("name");
  const cr_number = digits("cr_number");
  const vat_number = digits("vat_number");
  const fal_license_no = digits("fal_license_no");
  const rawPhone = text("contact_phone");
  const contact_phone = rawPhone === null ? null : foldDigits(rawPhone).trim();
  const contact_email = text("contact_email")?.toLowerCase() ?? null;
  const address_building_no = digits("address_building_no");
  const address_postal_code = digits("address_postal_code");
  const address_additional_no = digits("address_additional_no");
  const ibanRaw = text("iban");
  const iban = ibanRaw === null ? null : normalizeIban(ibanRaw);

  const values: OrgProfileValues = {
    name,
    cr_number,
    vat_number,
    fal_license_no,
    contact_phone: contact_phone || null,
    contact_email,
    address_building_no,
    address_street: text("address_street"),
    address_district: text("address_district"),
    address_city: text("address_city"),
    address_postal_code,
    address_additional_no,
    bank_name: text("bank_name"),
    bank_account_name: text("bank_account_name"),
    iban,
  };

  // Only the name is required. Everything else may stay empty for as long as the office needs —
  // what it cannot be is present and wrong, because these end up on documents.
  if (!name) return { values, error: "اسم المنشأة مطلوب", field: "name" };
  if (cr_number && !/^[0-9]{10}$/.test(cr_number)) {
    return { values, error: "رقم السجل التجاري يتكوّن من ١٠ أرقام", field: "cr_number" };
  }
  if (vat_number && !/^3[0-9]{13}3$/.test(vat_number)) {
    return { values, error: "الرقم الضريبي يتكوّن من ١٥ رقماً يبدأ بـ ٣ وينتهي بـ ٣", field: "vat_number" };
  }
  if (fal_license_no && !/^[0-9]{4,20}$/.test(fal_license_no)) {
    return { values, error: "رقم ترخيص فال يتكوّن من أرقام فقط", field: "fal_license_no" };
  }
  if (values.contact_phone && !PHONE_RE.test(values.contact_phone)) {
    return { values, error: "رقم هاتف غير صالح (مثال: 0112345678 أو 0501234567)", field: "contact_phone" };
  }
  if (contact_email && !EMAIL_RE.test(contact_email)) {
    return { values, error: "بريد إلكتروني غير صالح", field: "contact_email" };
  }
  if (address_building_no && !/^[0-9]{4}$/.test(address_building_no)) {
    return { values, error: "رقم المبنى في العنوان الوطني يتكوّن من ٤ أرقام", field: "address_building_no" };
  }
  if (address_postal_code && !/^[0-9]{5}$/.test(address_postal_code)) {
    return { values, error: "الرمز البريدي يتكوّن من ٥ أرقام", field: "address_postal_code" };
  }
  if (address_additional_no && !/^[0-9]{4}$/.test(address_additional_no)) {
    return { values, error: "الرقم الإضافي يتكوّن من ٤ أرقام", field: "address_additional_no" };
  }
  if (iban) {
    if (!/^SA[0-9]{22}$/.test(iban)) {
      return { values, error: "الآيبان السعودي يبدأ بـ SA ويتكوّن من ٢٤ خانة", field: "iban" };
    }
    if (!isValidIban(iban)) {
      return { values, error: "الآيبان غير صحيح — راجع الأرقام، يبدو أن أحدها مقلوب", field: "iban" };
    }
  }

  return { values };
}

/**
 * Postgres constraint names from 0066 → what the office should read, and under which input.
 *
 * These fire only for the checks the browser let through — a constraint the parser above does not
 * mirror, or a value edited past the form. The field is carried so even a database refusal lands
 * beside the box that caused it.
 */
export function orgWriteError(message: string): { error: string; field?: string } {
  if (/organization_vat_number_chk/.test(message)) {
    return { error: "الرقم الضريبي يتكوّن من ١٥ رقماً يبدأ بـ ٣ وينتهي بـ ٣", field: "vat_number" };
  }
  if (/organization_cr_number_chk/.test(message)) {
    return { error: "رقم السجل التجاري يتكوّن من ١٠ أرقام", field: "cr_number" };
  }
  if (/organization_iban_chk/.test(message)) {
    return { error: "الآيبان السعودي يبدأ بـ SA ويتكوّن من ٢٤ خانة", field: "iban" };
  }
  if (/organization_address_chk/.test(message)) {
    return { error: "تحقّق من أرقام العنوان الوطني (المبنى ٤، الرمز البريدي ٥، الإضافي ٤)", field: "address_building_no" };
  }
  if (/organization_fal_chk/.test(message)) {
    return { error: "رقم ترخيص فال يتكوّن من أرقام فقط", field: "fal_license_no" };
  }
  // Not a field's fault — the whole write was refused.
  if (/permission denied|row-level security/i.test(message)) {
    return { error: "تعديل بيانات المنشأة متاح للمدراء فقط" };
  }
  return { error: message };
}

/** The six national-address parts as one printable line, or null when nothing has been entered. */
export function nationalAddressLine(org: Record<string, unknown>): string | null {
  const part = (key: string) => {
    const v = org[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const street = [part("address_building_no"), part("address_street")].filter(Boolean).join(" ");
  const area = [part("address_district"), part("address_city")].filter(Boolean).join("، ");
  const codes = [part("address_postal_code"), part("address_additional_no")].filter(Boolean).join("-");
  const line = [street, area, codes].filter(Boolean).join("، ");
  return line || null;
}
