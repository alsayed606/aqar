// Generates the Arabic import templates (.xlsx) for each entity kind.
// Run: npm i xlsx@0.18.5 && node generate.mjs
// Headers MUST match HEADERS in ../functions/import-excel/index.ts and the parsers in migration 0016.
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SHEETS = {
  'template_properties': {
    headers: ['اسم العقار', 'نوع العقار', 'رقم الصك', 'المدينة', 'الحي', 'العنوان', 'اسم المالك'],
    example: ['برج الياسمين', 'تجاري', '3100012345', 'الرياض', 'العليا', 'طريق الملك فهد', ''],
  },
  'template_units': {
    headers: ['اسم العقار', 'رقم الوحدة', 'الدور', 'المساحة', 'غرف النوم', 'دورات المياه', 'الحالة'],
    example: ['برج الياسمين', '101', '1', '120', '3', '2', 'شاغرة'],
  },
  'template_owners': {
    headers: ['الاسم', 'النوع', 'رقم الهوية', 'الجوال', 'الآيبان', 'البنك'],
    example: ['محمد العتيبي', 'فرد', '1012345678', '0501234567', 'SA0000000000000000000000', 'الأهلي'],
  },
  'template_tenants': {
    headers: ['الاسم', 'النوع', 'رقم الهوية', 'الجوال', 'البريد الإلكتروني'],
    example: ['أحمد الشهري', 'فرد', '2087654321', '0559876543', 'ahmad@example.com'],
  },
  'template_contracts': {
    headers: ['رقم العقد', 'اسم العقار', 'رقم الوحدة', 'اسم المستأجر', 'رقم هوية المستأجر',
              'تاريخ البداية', 'تاريخ النهاية', 'الإيجار السنوي', 'دورية الدفع', 'التأمين',
              'رسوم الخدمات', 'رقم عقد إيجار', 'رقم الصك'],
    example: ['CT-2026-001', 'برج الياسمين', '101', 'أحمد الشهري', '2087654321',
              '2026-01-01', '2026-12-31', '120000', 'ربع سنوي', '10000', '5000', '', '3100012345'],
  },
  'template_charges': {
    headers: ['رقم العقد', 'نوع الاستحقاق', 'تاريخ الاستحقاق', 'المبلغ قبل الضريبة', 'نسبة الضريبة', 'الوصف'],
    example: ['CT-2026-001', 'إيجار تجاري', '2026-01-01', '30000', '0.15', 'دفعة الربع الأول'],
  },
};

for (const [name, { headers, example }] of Object.entries(SHEETS)) {
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.replace('template_', ''));
  const out = path.join(HERE, `${name}.xlsx`);
  XLSX.writeFile(wb, out);
  console.log('wrote', out);
}
