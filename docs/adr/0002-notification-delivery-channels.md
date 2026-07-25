# ADR-0002 — قنوات إرسال الإشعارات (Notification Delivery Channels)

- **الحالة:** مُعتمد ومُنفَّذ (Accepted) — قناة **البريد** مبنية في Sprint F (هجرة `0038`). قناة SMS تبقى مؤجَّلة ([ADR-0001](0001-sms-provider.md)).
- **النوع:** قرار معماري/تقني.
- **التاريخ:** ٢٥ يوليو ٢٠٢٦.
- **المبادئ الحاكمة:** م-١١ (ندمج لا نبني)، هـ-٤ (مصدر الحقيقة = الهجرات)، هـ-١٩ (لا أسرار في المستودع).
- **يرتبط بـ:** [ADR-0001](0001-sms-provider.md) (مزوّد SMS)، هجرة `0034` (جدول `notification`)، هجرة `0037` (هوية بريد/جوال).

## السياق
في Sprint C بنينا **الإشعارات داخل التطبيق فقط**: جدول `app.notification` (org_id، property_id، kind، title، body، due_date، read_at) + `generate_notifications` (توليد idempotent) + `mark_notifications_read`. لا توجد قناة إرسال خارجية. القرار التنفيذي (Sprint E): سنُضيف لاحقاً **قناة بريد** (وبعدها SMS) بجانب داخل التطبيق، لذا يجب ألا يتطلّب ذلك كسر ما بُني.

## التقييم: هل البنية الحالية جاهزة؟ نعم — بفصل نظيف
- **المحتوى محايد للقناة:** `title`/`body` نصّان عامّان صالحان للعرض داخل التطبيق أو في بريد/رسالة، بلا افتراض قناة.
- **الحدث مستقل عن التسليم:** `read_at` يخصّ العرض داخل التطبيق فقط؛ لا يخلط حالة الإرسال الخارجي بحالة القراءة.
- **المستقبِلون مُشتقّون:** التسليم الخارجي يحلّ المستلمين من الأعضاء → الهويات → (بعد `0037`) **بريد أو جوال**. أي أنّ الهوية صارت تحمل قناتَي وصول.

**الخلاصة:** `notification` لا يحتاج أي تعديل لاستقبال قناة بريد لاحقاً؛ القناة تُضاف كطبقة **إضافية** فوقه.

## القرار المُنفَّذ (Sprint F / هجرة `0038`)
صندوق إرسال منفصل **بلا لمس `notification`**:
- `notification_channel` enum: `in_app | email | sms` + `delivery_status` enum: `pending | sent | failed`.
- جدول `app.notification_delivery` (append-only): `org_id` (لـ RLS)، `notification_id` (FK)، `channel`، `target` (البريد المُحلّل)، `status`، `attempts`/`max_attempts`، `next_attempt_at` (بوابة الأهلية/الـbackoff)، `provider`، `provider_message_id`، `provider_response` (jsonb)، `last_error`، `last_attempt_at`، `created_at`، `sent_at`. فهرس فريد `(notification_id, channel, target)` = **idempotency**. RLS: قراءة لأعضاء المنشأة فقط.
- `enqueue_email_deliveries(org)` (DEFINER، جلسة المستخدم، `has_org_access`-gated): صفّ بريد لكل إشعار غير مقروء × كل عضو نشط له بريد. تُستدعى بعد `generate_notifications`.
- **الـ Drainer = Vercel Cron** (`/api/cron/drain-notifications`, كل ٥ دقائق) بـ service_role **حصراً**: `claim_email_deliveries` يحجز الصفوف ذرّياً (`FOR UPDATE SKIP LOCKED`) فلا إرسال مزدوج عند تراكب التشغيل → يُرسل عبر **Resend** (طبقة واحدة `lib/email/provider.ts`) → `mark_email_delivery_sent/failed`.
- **إعادة المحاولة:** حد أقصى ٣، فواصل ١→٥→٣٠ دقيقة (عبر `next_attempt_at`)، ثم `failed`.
- تفضيلات القنوات لكل مستخدم: تُضاف لاحقاً كحقول على الهوية/العضوية (خارج نطاق Sprint F).

هذا النمط **يعكس** `sms_outbox` القديم (المُسقَط في `0032`) لكن مُعمّماً للقنوات ومفصولاً عن التوليد.

## التبعات
- قناة البريد تعتمد **Resend** حصراً (SMTP لرسائل GoTrue + API للـ drainer). المزوّد قابل للاستبدال داخل `lib/email/provider.ts` فقط.
- لا تغيير على `notification`/`generate_notifications` → صفر كسر (future-proof).
- **قناة SMS** تُضاف لاحقاً بنفس النمط (قيمة `channel='sms'` + drainer عبر مزوّد ADR-0001) دون تعديل المخطط.
