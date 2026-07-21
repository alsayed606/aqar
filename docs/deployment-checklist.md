# قائمة مهام النشر | Deployment Checklist (فريق التطوير)

الخطوات المطلوبة لتشغيل تسجيل الدخول على البيئة الحيّة. نفّذها بالترتيب. علّم ✅ عند الإنجاز وحدّث [`../CHANGELOG.md`](../CHANGELOG.md).

مشروع Supabase: `hiuhvgykuovrbuiqcqvi` · المستودع: `alsayed606/aqar` (فرع `main`) · الاستضافة: Vercel.

---

## 1) تطبيق الهجرتين الجديدتين على قاعدة البيانات — `بيانات`

الهجرتان `0017` و`0018` **قابلتان لإعادة التشغيل بأمان** (idempotent) على القاعدة الحالية.

**الطريقة (SQL Editor):**
1. افتح: `https://supabase.com/dashboard/project/hiuhvgykuovrbuiqcqvi/sql/new`
2. الصق محتوى الملفين ثم Run (واحداً تلو الآخر أو معاً):
   - `supabase/migrations/0017_identity_auth_users.sql`
   - `supabase/migrations/0018_org_visibility.sql`
   - روابط مباشرة:
     `https://raw.githubusercontent.com/alsayed606/aqar/main/supabase/migrations/0017_identity_auth_users.sql`
     `https://raw.githubusercontent.com/alsayed606/aqar/main/supabase/migrations/0018_org_visibility.sql`
3. النتيجة المتوقعة: `Success`.

**التحقق (اختياري):**
```sql
-- يجب أن يُرجع صفاً واحداً: trigger موجود + الدالة موجودة
select
  (select count(*) from pg_trigger where tgname = 'on_auth_user_created')            as has_trigger,   -- 1
  (select count(*) from pg_proc  where proname = 'is_member_of')                     as has_fn;        -- 1
```

> ملاحظة: طُبّقت الهجرات `0001`–`0016` سابقاً يدوياً عبر SQL Editor. لا تُشغّل `schema_all.sql` على القاعدة الحيّة (سيفشل لأن الأنواع/الجداول موجودة) — طبّق فقط الهجرات الجديدة.

---

## 2) تفعيل تسجيل الدخول بالجوال في Supabase Auth — `بنية`

1. الوحة: **Authentication** ← **Providers** (أو Sign In / Providers) ← **Phone** ← فعّله (Enable).
2. **للاختبار بدون رسائل حقيقية** — أضِف رقماً تجريبياً برمز ثابت:
   في إعدادات Phone ابحث عن **Test phone numbers / Test OTP** وأضِف مثلاً:
   - الرقم: `+966500000001`  ← الرمز: `123456`
3. **للأرقام الحقيقية (لاحقاً)** — أحد خيارين:
   - مزوّد مدمج (Twilio / MessageBird / Vonage) من نفس الصفحة، أو
   - **Send SMS Hook** (Edge Function) لتوصيل مزوّد سعودي (Unifonic / Taqnyat) — سنبنيه عند الحاجة.

> بعد التفعيل: أول دخول لرقم جديد يُنشئ حساباً في `auth.users`، ويُنشئ trigger الهجرة `0017` تلقائياً ملف الهوية في `app.identity`.

---

## 3) ضبط متغيّرات البيئة في Vercel + إعادة النشر — `بنية`

بدون هذه المتغيّرات لن يتصل الموقع المنشور بقاعدة البيانات.

1. Vercel ← مشروع `aqar` ← **Settings** ← **Environment Variables**.
2. أضِف (لكل البيئات: Production / Preview / Development):

   | المفتاح | القيمة |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://hiuhvgykuovrbuiqcqvi.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | مفتاح anon العام (من Supabase ← Settings ← API) |

3. **Redeploy** (متغيّرات `NEXT_PUBLIC_*` تُدمج وقت البناء، فلا بدّ من إعادة نشر بعد إضافتها).

> تنبيه: مفتاح `anon` عام وآمن. **لا** تضع مفتاح `service_role` في متغيّرات `NEXT_PUBLIC_*` إطلاقاً.

---

## بعد إتمام 1–3: اختبار القبول | Acceptance test
1. افتح رابط الموقع على Vercel (أو محلياً `npm run dev`).
2. `/api/health` يجب أن يُظهر `ok: true`.
3. `/login` ← أدخل الرقم التجريبي `+966500000001` والرمز `123456` ← يجب أن تدخل إلى `/app`.
4. في `/app` ← أنشئ منشأة (مثال: "مكتب تجريبي") ← يجب أن تظهر كمنشأتك النشطة.
5. سجّل الخروج ثم أعد الدخول ← يجب أن تظهر المنشأة محفوظة.

عند نجاح هذه الخطوات، أبلغ لننتقل لأول شاشات سجل الحقيقة (العقارات/الوحدات/العقود + استيراد Excel).
