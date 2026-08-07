# عقار | Aqar — Saudi Property-Management SaaS

منصة SaaS سعودية لإدارة الأملاك (مكاتب إدارة الأملاك، والملّاك المباشرون). تطبيق **Next.js حيّ** فوق **Supabase (Postgres + RLS)**.
A Saudi property-management SaaS — a live Next.js app over Supabase (Postgres + RLS).

## الحالة | Status
**قيد التطوير النشط — التطبيق حيّ** على Vercel فوق PostgreSQL 17 (Supabase).
المرجع الأعلى للمشروع هو **[ميثاق المشروع](docs/foundation/07-project-charter.md)** ووثائق التأسيس في [`docs/foundation/`](docs/foundation/).

> **عدد الهجرات لا يُكتب هنا.** كُتب مرّة («٣١ هجرة») وبقي بينما صارت ٦٨. المصدر الحيّ هو مجلّد [`supabase/migrations/`](supabase/migrations/)، **وأيّها مطبَّق فعلاً** تقوله `/platform/health` من القاعدة نفسها (سجلّ الهجرات، `0068`).

**ما يعمل الآن (حيّ):** الدخول **بالبريد وكلمة المرور** مع استعادتها و«العودة بعد الدخول» · إنشاء منشأة والتبديل بينها · **إعدادات المنشأة** (هويّة نظامية، عنوان وطني، حساب بنكي، شعار) · لوحة المؤشرات · العقارات والوحدات · المستأجرون والعقود (تفعيل، جدول استحقاقات بملخّص مالي مُسبق، دفعات، ملاحق، **تجديد بعقد لاحق**) · استيراد Excel · الملّاك وكشوف الحسابات والتوريد · سند القبض · الفاتورة الضريبية (ZATCA مرحلة أولى + QR) · الإشعار الدائن/المدين · الفريق والأدوار والنطاقات · بوابتا المالك والمستأجر · **عدادات المرافق** · **صفحات السجل** (ملخّص، ملاحظات إلحاقية، خط زمني) · **التصدير إلى Excel** · **حرّاس الحذف** («امنع مع شرح») · **الخصوصية PDPL** · **لوحة إدارة المنصّة**.

> راجع [الميزات القادمة](docs/user-guide/05-roadmap.md) لما هو قيد التخطيط.

## المحتويات | Contents
| المسار | الوصف |
|---|---|
| [`app/`](app/), [`lib/`](lib/), [`components/`](components/), [`middleware.ts`](middleware.ts) | تطبيق Next.js 15 (App Router، RTL) + عملاء Supabase (SSR) مع `x-active-org` + حراسة المسارات |
| [`docs/foundation/`](docs/foundation/) | **وثائق التأسيس السبع (المرجع الرسمي) + الميثاق** |
| [`docs/adr/`](docs/adr/) | القرارات المعمارية (ADR) |
| [`docs/user-guide/`](docs/user-guide/) | دليل استخدام المنصة (عربي) |
| [`SCHEMA.md`](SCHEMA.md) | مرجع طبقة البيانات (المخطط/RLS/الدوال) — خريطة كل الهجرات |
| [`supabase/migrations/`](supabase/migrations/) | **هجرات SQL — مصدر الحقيقة.** كل واحدة تُسجّل نفسها في سطرها الأخير (`app.record_migration`) |
| [`supabase/schema_all.sql`](supabase/schema_all.sql) | تجميع الهجرات للتطبيق دفعة واحدة (SQL Editor) |
| [`supabase/tests/`](supabase/tests/) | اختبارات pgTAP + مُشغّل محلي (Node + PostgreSQL مُضمّن) |
| [`supabase/functions/import-excel/`](supabase/functions/import-excel/) | Edge Function لاستيراد Excel |
| [`supabase/templates/`](supabase/templates/) | قوالب استيراد عربية (.xlsx) |
| ~~`analysis/`~~ | **فُصل في ٦ أغسطس ٢٠٢٦** إلى مستودع بحث مستقلّ (`aqar-analysis`) — بحث لا منتج، وصفر استيراد منه في الكود |
| [`CHANGELOG.md`](CHANGELOG.md) | سجل تحديثات المشروع — يُحدَّث مع كل تغيير |

## البدء | Getting started
```bash
# 1) Web app
cp .env.example .env.local     # set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev                    # http://localhost:3000

# 2) Database — الهجرات مُطبَّقة على مشروع Supabase. لقاعدة جديدة: طبّق supabase/migrations/*.sql بالترتيب
#    (أو supabase/schema_all.sql في SQL Editor). اكشِف مخطط app: Supabase → Settings → API → Exposed schemas → app

# 3) Tests — كل المجموعات، واحدة تلو الأخرى (تحتاج Node 22.6+ لمجموعات .mts)
cd supabase/tests/local && npm install && npm run verify
#    المُشغّل يكتشف المجموعات من المجلّد، فالمجموعة الجديدة تدخل تلقائياً بلا قائمة تُحدَّث.
#    ⚠️ لا تشغّل مجموعتين معاً: كلٌّ منها تُقلع PostgreSQL على منفذ ثابت فتتصادمان.
```

## التقنيات | Stack
Next.js 15 (App Router, RSC + Server Actions, RTL) · Supabase (Postgres + RLS multi-tenancy، Auth، Storage، Edge Functions) · TypeScript · Tailwind. المبالغ بالهللات (أعداد صحيحة)؛ الحالة المالية مشتقّة؛ العقود مجمّدة بعد التفعيل؛ التدقيق append-only.

> **ملاحظات حوكمة:** كل تطوير يتبع [الميثاق](docs/foundation/07-project-charter.md). ملفات أداة Ruflo (`CLAUDE.md`, `.claude-flow/`, `.mcp.json`, `.swarm/`, `ruvector.db`) **ليست جزءاً من المشروع** ولا تُلتزَم.
