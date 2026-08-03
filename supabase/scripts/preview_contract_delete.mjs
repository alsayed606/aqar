// معاينة للقراءة فقط: تعرض ماذا سيحذف delete_contract.sql. لا تكتب شيئاً إطلاقاً.
// التشغيل: node supabase/scripts/preview_contract_delete.mjs CT-2026-00001
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// تحميل .env.local بدون طباعة أي مفتاح.
for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("مفقود: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const db = createClient(url, key, { db: { schema: "app" }, auth: { persistSession: false } });
const number = process.argv[2] || "CT-2026-00001";

const must = ({ data, error }) => { if (error) { console.error("خطأ:", error.message); process.exit(1); } return data; };
const ids = (rows) => rows.map((r) => r.id);

const contracts = must(await db.from("contract").select("*").eq("contract_number", number));
if (contracts.length === 0) { console.error(`لا يوجد عقد بالرقم ${number}`); process.exit(1); }
if (contracts.length > 1) { console.error(`الرقم ${number} مكرر في ${contracts.length} منظمات — حدّد org_id`); process.exit(1); }
const c = contracts[0];

const charges  = must(await db.from("charge").select("id,charge_type,due_date,amount_incl_vat_halalas,deleted_at").eq("contract_id", c.id));
const chargeIds = ids(charges);
const invoices = must(await db.from("invoice").select("id,invoice_number,status,total_halalas").eq("contract_id", c.id));
const invoiceIds = ids(invoices);

const allocs = chargeIds.length
  ? must(await db.from("payment_allocation").select("id,payment_id,charge_id,amount_halalas").in("charge_id", chargeIds))
  : [];
const touchedPayments = [...new Set(allocs.map((a) => a.payment_id))];
// دفعة تُحذف فقط إذا كانت كل تخصيصاتها ضمن مطالبات هذا العقد.
const otherAllocs = touchedPayments.length
  ? must(await db.from("payment_allocation").select("payment_id,charge_id").in("payment_id", touchedPayments))
  : [];
const shared = new Set(otherAllocs.filter((a) => !chargeIds.includes(a.charge_id)).map((a) => a.payment_id));
const paymentsToDelete = touchedPayments.filter((p) => !shared.has(p));
const paymentsKept = touchedPayments.filter((p) => shared.has(p));

const lines = invoiceIds.length
  ? must(await db.from("invoice_line").select("id").in("invoice_id", invoiceIds))
  : [];
const amendments = must(await db.from("contract_amendment").select("id,version,change_type").eq("contract_id", c.id));
const renewals   = must(await db.from("contract").select("id,contract_number").eq("renewed_from_contract_id", c.id));

const notifContract = must(await db.from("notification").select("id").eq("entity_type", "contract").eq("entity_id", c.id));
const notifCharge = chargeIds.length
  ? must(await db.from("notification").select("id").eq("entity_type", "charge").in("entity_id", chargeIds))
  : [];

const docFor = async (type, entityIds) =>
  entityIds.length ? must(await db.from("document").select("id,file_name,storage_bucket,storage_path").eq("entity_type", type).in("entity_id", entityIds)) : [];
const docs = [
  ...(await docFor("contract", [c.id])),
  ...(await docFor("charge", chargeIds)),
  ...(await docFor("payment", paymentsToDelete)),
];

const sar = (h) => (Number(h || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

console.log(`\n=== العقد ${c.contract_number} ===`);
console.log(`id            : ${c.id}`);
console.log(`org_id        : ${c.org_id}`);
console.log(`الحالة        : ${c.status}${c.deleted_at ? "  (محذوف منطقياً)" : ""}`);
console.log(`المدة         : ${c.start_date} → ${c.end_date}`);
console.log(`الإيجار السنوي: ${sar(c.annual_rent_halalas)} SAR`);
console.log(`unit_id       : ${c.unit_id}`);
console.log(`tenant_id     : ${c.tenant_id}`);

console.log(`\n=== سيُحذف ===`);
console.log(`مطالبات (charge)        : ${charges.length}   إجمالي ${sar(charges.reduce((s, x) => s + Number(x.amount_incl_vat_halalas || 0), 0))} SAR`);
console.log(`فواتير (invoice)        : ${invoices.length}`);
console.log(`بنود فواتير             : ${lines.length}`);
console.log(`تخصيصات دفعات           : ${allocs.length}   بمبلغ ${sar(allocs.reduce((s, x) => s + Number(x.amount_halalas || 0), 0))} SAR`);
console.log(`دفعات تُحذف بالكامل     : ${paymentsToDelete.length}`);
console.log(`دفعات مشتركة تبقى       : ${paymentsKept.length}`);
console.log(`ملاحق (amendment)       : ${amendments.length}`);
console.log(`إشعارات                 : ${notifContract.length + notifCharge.length}`);
console.log(`مستندات                 : ${docs.length}`);
console.log(`عقود تجديد يُفكّ ربطها  : ${renewals.length}${renewals.length ? "  → " + renewals.map((r) => r.contract_number).join(", ") : ""}`);

if (invoices.length) {
  console.log(`\n--- الفواتير ---`);
  for (const i of invoices) console.log(`  ${i.invoice_number}  ${i.status}  ${sar(i.total_halalas)} SAR`);
}
if (docs.length) {
  console.log(`\n--- ملفات Storage (تحتاج حذفاً يدوياً) ---`);
  for (const d of docs) console.log(`  ${d.storage_bucket}/${d.storage_path}   (${d.file_name})`);
}
console.log(`\nلم يُحذف شيء. هذه معاينة قراءة فقط.\n`);
