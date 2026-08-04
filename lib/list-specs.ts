import { likePattern } from "@/lib/list-params";
import { halalasToPlainSar } from "@/lib/money";
import { first } from "@/lib/rows";
import type { CsvColumn } from "@/lib/csv";
import {
  PROPERTY_KIND_AR,
  CONTRACT_STATUS_AR,
  DOC_KIND_AR,
  PAYMENT_METHOD_AR,
} from "@/lib/labels";
import { ENTITY_TYPES } from "@/lib/tenant-identity";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * One description per list, owning the three things the screen and the export must agree on: how a
 * search term is matched, which sorts are offered, and what a row looks like in Excel.
 *
 * They live together because the export must return *the filtered set the user is looking at*. If
 * the page built its own filter and the export route built another, the two would drift and the
 * file would quietly stop matching the screen — the same failure the design system warns about for
 * 360 pages that re-implement a table.
 */

export type SortOption = {
  key: string;
  label: string;
  column: string;
  ascending: boolean;
  /** Sorts on an embedded relation need PostgREST told which table the column belongs to. */
  referencedTable?: string;
};

export type ListSpec = {
  table: string;
  /** Columns for the export query. The screen may select fewer or more for its own layout. */
  select: string;
  applySearch: (query: any, q: string) => any;
  sorts: SortOption[];
  columns: CsvColumn<any>[];
  /** URL param → column, for deep links from a 360 page. The export honours these too, so the
   *  downloaded file is the same filtered set the screen is showing. */
  filters?: Record<string, string>;
  /** Base of the download filename; the date is appended. ASCII, so no header encoding guesswork. */
  filename: string;
  /** Arabic label used in the export button's title. */
  label: string;
};

const ilike = (column: string) => (query: any, q: string) => query.ilike(column, likePattern(q));

// A sort must never interpolate user input into the query. Only a key from this list is honoured.
export function resolveSort(spec: ListSpec, key: string | undefined): SortOption {
  return spec.sorts.find((s) => s.key === key) ?? spec.sorts[0];
}

export function applySort(query: any, sort: SortOption) {
  return query.order(sort.column, {
    ascending: sort.ascending,
    ...(sort.referencedTable ? { referencedTable: sort.referencedTable } : {}),
  });
}

const NEWEST: SortOption = { key: "newest", label: "الأحدث أولاً", column: "created_at", ascending: false };
const OLDEST: SortOption = { key: "oldest", label: "الأقدم أولاً", column: "created_at", ascending: true };

export const LIST_SPECS: Record<string, ListSpec> = {
  properties: {
    table: "property",
    select: "id, name, property_code, property_kind, holding_type, city, district, deed_number, created_at",
    applySearch: ilike("name"),
    sorts: [
      NEWEST,
      OLDEST,
      { key: "name", label: "الاسم (أ-ي)", column: "name", ascending: true },
      { key: "city", label: "المدينة", column: "city", ascending: true },
    ],
    columns: [
      { header: "اسم العقار", value: (r) => r.name },
      { header: "الكود", value: (r) => r.property_code },
      { header: "التصنيف", value: (r) => PROPERTY_KIND_AR[r.property_kind] ?? r.property_kind },
      { header: "المدينة", value: (r) => r.city },
      { header: "الحي", value: (r) => r.district },
      { header: "رقم الصك", value: (r) => r.deed_number },
    ],
    filename: "properties",
    label: "العقارات",
  },

  tenants: {
    table: "tenant",
    select:
      "id, tenant_type, created_at, party:party_id!inner(display_name, primary_id, phone_e164, email, rep_name, identity_complete)",
    // Mirrors the screen exactly: name, representative, and the primary identifier or phone once
    // the typed value is reduced to digits (identifiers are stored unformatted).
    applySearch: (query, q) => {
      const digits = q.replace(/\D/g, "");
      const terms = [
        `display_name.ilike.${likePattern(q)}`,
        `rep_name.ilike.${likePattern(q)}`,
        ...(digits ? [`primary_id.ilike.${likePattern(digits)}`, `phone_e164.ilike.${likePattern(digits)}`] : []),
      ];
      return query.or(terms.join(","), { referencedTable: "party" });
    },
    sorts: [
      NEWEST,
      OLDEST,
      { key: "name", label: "الاسم (أ-ي)", column: "display_name", ascending: true, referencedTable: "party" },
    ],
    columns: [
      { header: "الاسم", value: (r) => first(r.party)?.display_name },
      { header: "النوع", value: (r) => ENTITY_TYPES.find((t) => t.value === r.tenant_type)?.label ?? r.tenant_type },
      { header: "المعرّف الرئيسي", value: (r) => first(r.party)?.primary_id },
      { header: "ممثّل المنشأة", value: (r) => first(r.party)?.rep_name },
      { header: "الجوال", value: (r) => first(r.party)?.phone_e164 },
      { header: "البريد", value: (r) => first(r.party)?.email },
      { header: "البيانات مكتملة", value: (r) => (first(r.party)?.identity_complete ? "نعم" : "لا") },
    ],
    filename: "tenants",
    label: "المستأجرين",
  },

  owners: {
    table: "owner",
    select:
      "id, is_self, owner_kind, iban, bank_name, created_at, party:party_id!inner(display_name, national_id, phone_e164, email)",
    applySearch: ilike("party.display_name"),
    sorts: [
      { key: "self", label: "المالك الذاتي أولاً", column: "is_self", ascending: false },
      NEWEST,
      { key: "name", label: "الاسم (أ-ي)", column: "display_name", ascending: true, referencedTable: "party" },
    ],
    columns: [
      { header: "الاسم", value: (r) => (r.is_self ? "المنشأة (مالك ذاتي)" : first(r.party)?.display_name) },
      { header: "رقم الهوية", value: (r) => first(r.party)?.national_id },
      { header: "الجوال", value: (r) => first(r.party)?.phone_e164 },
      { header: "البريد", value: (r) => first(r.party)?.email },
      { header: "الآيبان", value: (r) => r.iban },
      { header: "البنك", value: (r) => r.bank_name },
    ],
    filename: "owners",
    label: "الملّاك",
  },

  contracts: {
    table: "contract",
    select:
      "id, contract_number, status, start_date, end_date, annual_rent_halalas, created_at, unit:unit_id(unit_number, property:property_id(name)), tenant:tenant_id(party:party_id(display_name))",
    applySearch: ilike("contract_number"),
    sorts: [
      NEWEST,
      { key: "ending", label: "الأقرب انتهاءً", column: "end_date", ascending: true },
      { key: "starting", label: "الأحدث بداية", column: "start_date", ascending: false },
      { key: "rent", label: "الأعلى إيجاراً", column: "annual_rent_halalas", ascending: false },
    ],
    columns: [
      { header: "رقم العقد", value: (r) => r.contract_number },
      { header: "المستأجر", value: (r) => first(first(r.tenant)?.party)?.display_name },
      { header: "العقار", value: (r) => first(first(r.unit)?.property)?.name },
      { header: "الوحدة", value: (r) => first(r.unit)?.unit_number },
      { header: "الحالة", value: (r) => CONTRACT_STATUS_AR[r.status] ?? r.status },
      { header: "من", value: (r) => r.start_date },
      { header: "إلى", value: (r) => r.end_date },
      { header: "الإيجار السنوي (ر.س)", value: (r) => halalasToPlainSar(r.annual_rent_halalas) },
    ],
    filters: { tenant: "tenant_id", property: "property_id" },
    filename: "contracts",
    label: "العقود",
  },

  invoices: {
    table: "invoice",
    select:
      "id, invoice_no, doc_kind, issue_at, buyer_name, total_excl_vat_halalas, total_vat_halalas, total_incl_vat_halalas, status, created_at",
    applySearch: ilike("invoice_no"),
    sorts: [
      { key: "newest", label: "الأحدث أولاً", column: "issue_at", ascending: false },
      { key: "oldest", label: "الأقدم أولاً", column: "issue_at", ascending: true },
      { key: "amount", label: "الأعلى مبلغاً", column: "total_incl_vat_halalas", ascending: false },
    ],
    columns: [
      { header: "رقم المستند", value: (r) => r.invoice_no },
      { header: "النوع", value: (r) => DOC_KIND_AR[r.doc_kind] ?? r.doc_kind },
      { header: "التاريخ", value: (r) => String(r.issue_at ?? "").slice(0, 10) },
      { header: "المشتري", value: (r) => r.buyer_name },
      { header: "غير شامل الضريبة (ر.س)", value: (r) => halalasToPlainSar(r.total_excl_vat_halalas) },
      { header: "الضريبة (ر.س)", value: (r) => halalasToPlainSar(r.total_vat_halalas) },
      { header: "الإجمالي (ر.س)", value: (r) => halalasToPlainSar(r.total_incl_vat_halalas) },
      { header: "الحالة", value: (r) => (r.status === "cancelled" ? "ملغاة" : "سارية") },
    ],
    filename: "invoices",
    label: "الفواتير",
  },

  receipts: {
    table: "payment",
    select: "id, receipt_no, amount_halalas, method, received_at, notes, created_at, party:party_id(display_name)",
    applySearch: ilike("receipt_no"),
    sorts: [
      { key: "newest", label: "الأحدث أولاً", column: "received_at", ascending: false },
      { key: "oldest", label: "الأقدم أولاً", column: "received_at", ascending: true },
      { key: "amount", label: "الأعلى مبلغاً", column: "amount_halalas", ascending: false },
    ],
    columns: [
      { header: "رقم السند", value: (r) => r.receipt_no },
      { header: "الدافع", value: (r) => first(r.party)?.display_name },
      { header: "التاريخ", value: (r) => String(r.received_at ?? "").slice(0, 10) },
      { header: "طريقة الدفع", value: (r) => PAYMENT_METHOD_AR[r.method] ?? r.method },
      { header: "المبلغ (ر.س)", value: (r) => halalasToPlainSar(r.amount_halalas) },
      { header: "ملاحظة", value: (r) => r.notes },
    ],
    filters: { party: "party_id" },
    filename: "receipts",
    label: "السندات",
  },
};

export type ListResource = keyof typeof LIST_SPECS;
