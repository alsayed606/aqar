# عقار | Aqar — Saudi Property-Management SaaS

منصة SaaS سعودية لإدارة الأملاك (مكاتب إدارة الأملاك، مكاتب العقار، الملّاك). هذا المستودع يضم حتى الآن:
A Saudi property-management SaaS. This repository currently contains:

## المحتويات | Contents

| المسار | الوصف |
|---|---|
| [`SCHEMA.md`](SCHEMA.md) | توثيق طبقة البيانات (المرحلة الأولى) + القرارات المؤجّلة — Data-layer design + Deferred Decisions |
| [`supabase/migrations/`](supabase/migrations/) | 16 هجرة SQL: المخطط، RLS، دوال SECURITY DEFINER، المصادقة/OTP، المالية، الاستيراد |
| [`supabase/tests/`](supabase/tests/) | اختبارات pgTAP للاختبارات الإلزامية ١–١٣ |
| [`supabase/tests/local/`](supabase/tests/local/) | مُشغّل محلي (Node + PostgreSQL مُضمّن) — `npm run verify` |
| [`supabase/functions/import-excel/`](supabase/functions/import-excel/) | Edge Function لاستيراد Excel |
| [`supabase/templates/`](supabase/templates/) | قوالب استيراد عربية (.xlsx) |
| [`analysis/`](analysis/) | تحليل المنافسين (Diiwan، Rawaf Amlak، Amlak One) — [`analysis/REPORT.md`](analysis/REPORT.md) |

## الحالة | Status

**المرحلة الأولى — سجل الحقيقة (System of Record): طبقة بيانات فقط، مُتحقَّق منها على PostgreSQL 17.**
Phase 1 — data layer only, verified on PostgreSQL 17 (all 16 migrations load clean; 36/36 behavioural checks + 3/3 pgTAP files pass). No UI/app code yet — awaiting sign-off before Phase 2.

## البدء | Getting started

```bash
cp .env.example .env          # fill in Supabase keys (do not commit .env)

# apply migrations
supabase db reset             # or: for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done

# run tests
supabase test db              # pgTAP (needs: create extension pgtap;)
cd supabase/tests/local && npm install && npm run verify   # -> 36 passed, 0 failed
```

راجع [`supabase/README.md`](supabase/README.md) لتفاصيل التشغيل والإعداد المطلوب (سياق المنظمة، الـ OTP pepper، مزوّد الرسائل).

## التقنيات | Stack
Next.js (SSR) · Supabase (Postgres + RLS multi-tenancy, Auth, Storage, Edge Functions) · ZATCA Phase-2 ready · PDPL-aware · Arabic-first RTL · Moyasar/Tap (mada / Apple Pay).
