# سجل الحقيقة — مخطط قاعدة البيانات | System of Record — Data Schema
### منصة إدارة الأملاك — مرجع طبقة البيانات | Property-Management SaaS — Data-Layer Reference

**الحالة | Status:** طبقة البيانات **حيّة ومكتملة** — ٣١ هجرة (`0001`–`0031`) مُطبَّقة على PostgreSQL 17، والتطبيق مبنيّ وحيّ فوقها. هذا الملف يوثّق طبقة البيانات (المخطط/RLS/الدوال). **المرجع الأعلى للمشروع:** [`docs/foundation/07-project-charter.md`](docs/foundation/07-project-charter.md).
**التحقق | Verification:** الهجرات تُحمَّل على PostgreSQL 17؛ سويت طبقة البيانات المُلتزَم **36/36** ([`supabase/tests/local/`](supabase/tests/local/) + pgTAP). *(ملاحظة: ميزات المرحلة الثالثة `0019`–`0031` تحتاج اختبارات مُلتزَمة — مُجدوَل في Sprint B، القاعدة هـ-36.)*

> هذا الملف يوثّق ما نفّذته الهجرات فعلياً في [`supabase/migrations/`](supabase/migrations/)، لا نيّة تصميمية. كل قاعدة في التكليف مربوطة أدناه بجدول/دالة/سياسة/اختبار.

---

## 0) خريطة الملفات | File map

| ملف | المحتوى |
|---|---|
| `0001_extensions_roles.sql` | schemas (`app`, `extensions`)، pgcrypto/citext، أدوار Supabase |
| `0002_enums.sql` | كل الـ enums (بما فيها `org_type` — عرض فقط) |
| `0003_utils.sql` | `auth.uid()`، تطبيع الجوال/المبلغ/التاريخ، `set_updated_at` |
| `0004_identity_auth.sql` | Identity + (AuthMethod, Session, OTP, auth_attempt, sms_outbox — **أُزيلت في `0032`**؛ Identity يبقى) |
| `0005_org_membership.sql` | Organization, FeatureFlag, Membership, property-scope, Invitation |
| `0006_party_property.sql` | Party, Owner(is_self), Tenant, Property, Building, Unit, UnitStatusHistory |
| `0007_contracts_agreements.sql` | Contract, ContractAmendment, ManagementAgreement |
| `0008_charges_payments.sql` | Charge, Payment, PaymentAllocation |
| `0009_documents_audit.sql` | Document, AuditLog |
| `0010_import_staging.sql` | import_batch, import_row |
| `0011_access_functions.sql` | `current_org_id`, `has_org_access`, `has_property_access`, `is_org_admin` |
| `0012_rls_policies.sql` | RLS مُفعّلة + سياسات كل جدول + المنح |
| `0013_triggers_guards.sql` | ثبات العقد، حماية آخر مالك، منع الربط التلقائي، تاريخ حالة الوحدة، ثوابت التخصيص، سجل التدقيق غير القابل للتعديل، RPCs |
| `0014_auth_otp.sql` | request_otp / verify_otp / rate-limit / enumeration-safe — **أُزيلت في `0032`** (استبدلها Supabase Auth، 0017) |
| `0015_financial_views.sql` | `charge_balance`, `contract_financial`, `unit_financial`, `payment_status` (مشتقّة) |
| `0016_import_functions.sql` | import_validate / import_commit / import_revert + mappers |
| `0017_identity_auth_users.sql` | ربط `app.identity` بـ `auth.users` + trigger `on_auth_user_created` (Supabase Auth) — **يُلغي عملياً OTP المخصّص في `0004`/`0014`، وهو كود مهجور يُزال في Sprint B** |
| `0018_org_visibility.sql` | `is_member_of()` + رؤية المنظمة لمبدّل المنشآت |
| `0019_contract_ops.sql` | `activate_contract` (توليد جدول الاستحقاقات) + `record_charge_payment` |
| `0020_owner_statement.sql` | `owner_statement` (المُحصَّل − الأتعاب = الصافي، مشتق) |
| `0021_dashboard_kpis.sql` | `dashboard_finance` (إشغال/تحصيل/متأخرات/مستحق — حدود الشهر بتوقيت الرياض) |
| `0022_receipt_vouchers.sql` | `org_counter`/`next_counter` (ترقيم ذرّي) + `receipt_no` على الدفعة (سند القبض `RV-YYYY-NNNNN`) |
| `0023_tax_invoice.sql` | `invoice`/`invoice_line` + `issue_invoice` + `owner.vat_number` (فاتورة ZATCA مرحلة أولى + QR) |
| `0024_credit_debit_notes.sql` | `doc_kind` + `issue_credit_note`/`issue_debit_note` (إشعار دائن/مدين) |
| `0025_owner_remittance.sql` | `owner_remittance` + ترقيم سند الصرف `RM-YYYY-NNNNN` |
| `0026_member_invitations.sql` | `org_members` + `create_invitation` (دعوة الأعضاء، رمز مُجزّأ) |
| `0027_contract_amendments.sql` | `amend_contract_rent`/`amend_contract_terminate` + `contract_period_shape` (ملاحق العقد) |
| `0028_owner_portal.sql` | بوابة المالك: `create_owner_invitation`/`accept_owner_invitation` + دوال `owner_portal_*` محكومة بـ `party.identity_id=auth.uid()` |
| `0029_tenant_portal.sql` | بوابة المستأجر: `create_tenant_invitation` + `accept_portal_invitation` (عام) + دوال `tenant_portal_*` محكومة بالهوية |
| `0030_portal_documents.sql` | مستندات البوابة القابلة للطباعة: `tenant_portal_receipt(+_lines)` + `owner_portal_org` |
| `0031_contract_renewal.sql` | تجديد العقد: `renewed_from_contract_id` + `renew_contract` + `activate_renewal` (عقد لاحق يحترم ثبات العقد) |
| `0032_drop_legacy_otp.sql` | **إزالة** نظام OTP/الجلسات المخصّص المهجور (otp_challenge/auth_attempt/sms_outbox/session/auth_method + دواله + `auth_method_type`)؛ Identity يبقى |
| `0033_viewer_readonly.sql` | `is_org_writer()` + سياسات RLS تقييدية (INSERT/UPDATE/DELETE) تجعل دور `viewer` **للقراءة فقط** على جداول المحفظة والمالية |

---

## 1) القرارات المعمارية الملزمة وأين طُبّقت | Binding decisions → where enforced

| القرار (التكليف) | التطبيق | الاختبار |
|---|---|---|
| §2 نموذج واحد؛ `org_type` عرض فقط | لا فرع على `org_type` في أي trigger/policy/constraint؛ الفروق عبر `feature_flag` | مراجعة + `grep` (لا وجود لـ `org_type` في 0011–0016) |
| §2 المالك كيان مستقل دائماً؛ self-owner تلقائي | `app.create_organization` يُنشئ `owner(is_self=true)`؛ فهرس `owner_one_self_per_org` | seed + harness |
| §3 هوية/عضوية/طرف منفصلة | `identity`(عالمي) / `membership`(identity×org) / `party`(داخل المنظمة) | T1, T5 |
| §3 مستخدم في أكثر من منظمة | لا "جدول مستخدمين داخل المنظمة"؛ `membership` هو الجسر | T1 (نفس الهوية ترى org1 وorg2 حسب السياق) |
| §3 `party.identity_id` قابل لـ NULL، يُملأ بالدعوة فقط | عمود nullable + `tg_party_identity_guard` | T10 |
| §4 الجوال المفتاح العالمي؛ تطبيع عند الكتابة | `identity.phone_e164 unique` + `require_phone_e164` | T6 |
| §4 OTP مُجزّأ/صلاحية/استخدام واحد/حد/6 رقم تشفيري | `otp_challenge` + `request_otp`/`verify_otp` + `gen_otp_code` | T7, T8, T9 |
| §5 الدعوة تُقبل بالرمز لا بالرقم | `accept_invitation(token)`؛ لا ربط تلقائي بالجوال | T10 |
| §5 حماية آخر مالك | `tg_protect_last_owner` | harness (LAST_OWNER_PROTECTED) |
| §6 `org_id` على كل جدول تشغيلي + RLS | كل جدول org-scoped يحمل `org_id`؛ RLS مُفعّلة على الكل | T1–T5 |
| §6 لا `org_id` في JWT؛ يُثبَت كل استعلام | `current_org_id()` من الترويسة + `has_org_access` (EXISTS على membership) | T2, T3 |
| §6 نطاق العقارات طبقة ثانية | `has_property_access` + `membership_property_scope` | T4, T5 |
| §6 لا تكرار لانهائي في سياسة membership | المنطق داخل `SECURITY DEFINER` + `search_path` مثبّت | لا خطأ recursion عند التشغيل |
| §6 الإلغاء يقطع الوصول فوراً | الحالة تُفحَص حيّة كل استعلام | T2 |
| §7.1 الحالة المالية تُشتق لا تُخزَّن | لا عمود status مالي؛ `charge`+`payment_allocation`؛ views 0015 | T12 |
| §7.2 جاهزية ضريبية على كل charge | `amount_excl_vat/vat_rate/vat_amount/charge_type` | مخطط + import |
| §7.3 المبالغ integer بالهللات | كل حقل مالي `bigint`؛ لا float | T13 |
| §7.4 UTC + عرض Riyadh + هجري | `timestamptz`؛ `*_hijri` نصّي للعرض | مخطط |
| §7.5 العقد غير قابل للتعديل بعد التفعيل | `tg_contract_immutable` + `contract_amendment` | T11 |
| §7.6 حذف soft دائماً | `deleted_at/by/reason` على كل جدول | مخطط + import_revert |
| §7.7 مواءمة حقول إيجار الآن | حقول العقد/الطرف/العقار (رقم عقد، صك، هوية، جدول دفعات) | مخطط |
| §7.8 E.164 في كل الجداول | `party.phone_e164`, `invitation.phone_e164`, CHECK موحّد | مخطط |
| §7.9 الهرمية + owner على العقار | `Organization→Property→Building→Unit`؛ `property.owner_id NOT NULL` | مخطط |
| §7.10 حالة الوحدة enum + تاريخ | `unit.current_status` + `unit_status_history` + `tg_unit_status_sync` | مخطط |
| §7.11 ManagementAgreement كيان زمني | جدول مستقل بفترة/نموذج أتعاب/سياسة توريد | مخطط |
| §8 AuditLog append-only بثلاثة معرّفات | `audit_log(identity_id, org_id, membership_id)` + `tg_audit_immutable` | harness (AUDIT_APPEND_ONLY) |

---

## 2) نموذج الهوية والوصول | Identity & access model

```
Identity (عالمي: من الشخص؟)  ── auth.uid()
   │ 1
   │ *                       AuthMethod / Session / (OTP challenge بالجوال)
Membership (identity × org: أين يعمل وبأي دور/نطاق؟)
   │                         status: invited|active|suspended|revoked  ← لا تُحذف
   │                         scope_all + membership_property_scope[]
Organization ──< FeatureFlag (الفروق بين الشرائح، لا org_type)
   │
Party (داخل المنظمة: من هو في سجلاتنا؟  identity_id قابل لـ NULL)
   ├─ Owner (is_self)   ├─ Tenant     (…vendor/broker لاحقاً عبر party_role)
```

**كيف يُثبَت العزل في كل استعلام (بدون JWT org claim):**
1. العميل يرسل المنظمة النشطة في ترويسة `x-active-org` (أو GUC للخوادم الموثوقة).
2. `app.current_org_id()` يقرأها كـ **ادعاء غير موثوق**.
3. كل سياسة RLS تستدعي `app.has_org_access(org_id)` التي تشترط:
   `org_id = current_org_id()` **و** وجود عضوية `active` حيّة لـ `auth.uid()` في هذه المنظمة.
4. الطبقة الثانية `has_property_access` تقصر الموظف على محفظته حين `scope_all=false`.
5. الدوال `SECURITY DEFINER` بـ `search_path` مثبّت → لا تُشغّل RLS الخاصة بـ `membership` → لا تكرار لانهائي، والإلغاء يقطع الوصول في الاستعلام التالي مباشرة.

> **لماذا لا JWT claim؟** الرمز يبقى صالحاً بعد الإلغاء؛ فلو حملنا `org_id` فيه لتأخّر قطع الوصول حتى انتهاء صلاحيته. إثباتُه في كل استعلام يجعل الإلغاء فورياً (اختبار ٢).

---

## 3) الكيانات والحقول | Entities & fields (مختصر — التعريف الكامل في الهجرات)

### الهوية والمصادقة | Identity & auth (`0004`)
- **identity**(`id`=auth.uid(), `phone_e164` **UNIQUE** `^\+9665\d{8}$`, `phone_raw` عرض, `email` citext unique, `preferred_locale`, `status`, `security_frozen_until`, soft-delete). المفتاح العالمي هو الجوال.
- **auth_method**(`identity_id`, `method`∈{phone_otp,passkey,email,sso}, `detail` jsonb, …) — WebAuthn/SSO تُضاف بلا هجرة (`detail` jsonb).
- **session**(`refresh_token_hash`, `device_fingerprint`, `rotated_from`, `reuse_detected`, `is_new_device`, `expires_at`, `revoked_at`) — تدوير وكشف إعادة استخدام.
- **otp_challenge**(`phone_e164`, `code_hash`, `purpose`, `attempts/max_attempts`, `expires_at`, `consumed_at`) — مُجزّأ، استخدام واحد، 5 دقائق.
- **auth_attempt** — يغذّي الحدّ لكل رقم/IP/جهاز. **sms_outbox** — حدود المزوّد القابل للتبديل (Unifonic/Taqnyat/احتياطي).

### المنظمة والعضوية | Org & membership (`0005`)
- **organization**(`name`, `org_type` *عرض فقط*, `cr_number`, `vat_number`, `default_timezone`).
- **feature_flag**(`org_id`, `key`, `is_enabled`, `config` jsonb) — كل فرق بين الشرائح.
- **membership**(`identity_id`, `org_id`, `role`, `status`, `scope_all`, UNIQUE(identity,org))، فهرس `(identity_id,org_id,status)`.
- **membership_property_scope**(`membership_id`, `property_id`).
- **invitation**(`org_id`, `phone_e164`/`email`, `role`, `scope_*`, `token_hash`, `expires_at`, `accepted_at`, `revoked_at`).

### الأطراف والأصول | Parties & assets (`0006`)
- **party**(`org_id`, `identity_id`? , `display_name`, `legal_kind`, `national_id`, `iqama_id`, `cr_number`, `phone_e164`, `email`, `roles[]`). فريد `(org_id, identity_id)`.
- **owner**(`party_id`, `is_self`, `owner_kind`, `iban`, `bank_name`) — تغيير الآيبان يتطلب step-up (تطبيقي).
- **tenant**(`party_id`, `tenant_kind`).
- **property**(`org_id`, `owner_id` **NOT NULL**, `name`, `property_kind`, `deed_number`, عنوان/إحداثيات).
- **building**(`property_id`, `name`, `floors`).
- **unit**(`property_id`, `building_id`?, `unit_number`, `unit_ref`, `area_sqm`, `current_status`, UNIQUE(property,unit_number)).
- **unit_status_history**(`unit_id`, `status`, `from_ts`, `to_ts`, `changed_by`) — segment مفتوح واحد فقط (فهرس جزئي). الإشغال يُحسب من هنا.

### العقود والاتفاقيات | Contracts (`0007`)
- **contract**(`property_id`, `unit_id`, `tenant_id`, `contract_number` UNIQUE/org, `ejar_contract_number`, `deed_number`, `contract_kind`, `status`, `start/end_date`, `*_hijri`, `annual_rent_halalas`, `payment_frequency`, `deposit_halalas`, `service_fees_halalas`, `terms`, `activated_at`, `terminated_at`). **بلا عمود حالة مالية.** فهرس جزئي: عقد نشط واحد لكل وحدة.
- **contract_amendment**(`contract_id`, `version`, `change_type`, `payload` jsonb {from,to}, `effective_date`) — السبيل الوحيد لتغيير عقد نشط.
- **management_agreement**(`owner_id`, `property_id`?, `valid_from/to`, `fee_model`, `fee_percentage`|`fee_amount_halalas`, `remittance_policy` jsonb) + **management_agreement_unit** لمستوى الوحدة. كيان زمني مستقل.

### المالية | Financials (`0008`) — كل المبالغ `bigint` هللات
- **charge**(`property_id`, `unit_id`?, `contract_id`?, `charge_type`, `due_date`, `amount_excl_vat_halalas`, `vat_rate` numeric(5,4), `vat_amount_halalas`, `amount_incl_vat_halalas` **GENERATED**). سطر استحقاق واحد.
- **payment**(`party_id`?, `method`, `amount_halalas`, `received_at`, `reference`). منفصلة عن الاستحقاقات.
- **payment_allocation**(`payment_id`, `charge_id`, `amount_halalas`, UNIQUE(payment,charge)) — يطابق الدفعات على الاستحقاقات؛ ثوابت السقف عبر `tg_allocation_check`.
- **Views (مشتقّة، `security_invoker`)**: `charge_balance` (balance/settled/overdue)، `contract_financial`، `unit_financial`، `payment_status` (الرصيد غير المخصَّص = ائتمان).

### المستندات والتدقيق | Documents & audit (`0009`)
- **document**(`org_id`, `entity_type`, `entity_id`, `property_id`?, `storage_bucket/path`, `file_name`, `mime_type`, `byte_size`).
- **audit_log**(`org_id`, `identity_id`, `membership_id`, `action`, `entity_type/id`, `detail` jsonb, `ip`, `device_fingerprint`) — **append-only**؛ يسجّل تبديل المنظمة/الدخول/الجلسات/step-up.

### الاستيراد | Import (`0010`)
- **import_batch**(`org_id`, `kind`, `status`, عدّادات, `committed_at`, `reverted_at`).
- **import_row**(`batch_id`, `row_number`, `raw` jsonb, `normalized` jsonb, `is_valid`, `errors` jsonb[], `created_entity_type/id`).

---

## 4) الاختبارات | Tests

**pgTAP (لِـ `supabase test db`):** [`supabase/tests/01_isolation_rls.sql`](supabase/tests/01_isolation_rls.sql) · [`02_auth.sql`](supabase/tests/02_auth.sql) · [`03_modeling.sql`](supabase/tests/03_modeling.sql).
**Runner محلي مُثبت (Node + PG17، بلا Supabase):** [`supabase/tests/local/`](supabase/tests/local/) → `npm i && npm run verify` → **36 passed, 0 failed**.

يغطيان الاختبارات الإلزامية ١–١٣ حرفياً، زائد: جولة استيراد كاملة (تحقّق/اعتماد/تراجع)، منع تعديل/حذف سجل التدقيق، وحماية آخر مالك.

---

## 5) الاستيراد من Excel | Excel import (§11)

- **قوالب عربية جاهزة**: [`supabase/templates/*.xlsx`](supabase/templates/) (عقارات/وحدات/ملّاك/مستأجرون/عقود/استحقاقات) + مولّدها `generate.mjs`.
- **الآلية**: Edge Function [`import-excel`](supabase/functions/import-excel/index.ts) يفكّ الملف ويُدرج الصفوف في `import_row`، ثم:
  - `import_validate` — تطبيع (جوال/تاريخ/مبلغ بنفس دوال النظام) + **تقرير أخطاء لكل صف** (`{field, value, reason}`) + حلّ المراجع (عقار/وحدة/مستأجر/عقد).
  - `import_commit` — يُنشئ الكيانات للصفوف الصحيحة فقط ويَسِم ما أنشأه كل صف.
  - `import_revert` — **تراجع دفعة كاملة** بحذف soft لكل ما أُنشئ.
- المعاينة قبل الاعتماد = نتيجة `import_validate` (لا شيء يُلتزم قبل `import_commit`). RLS يسري (لا تصعيد لـ service_role).

---

## 6) القرارات المؤجَّلة | Deferred Decisions
> كيف يستوعب النموذج كلّاً منها **دون أي ترحيل لاحق** (بلا `ALTER` على بيانات تاريخية).

### أ) ZATCA — الفوترة الإلكترونية المرحلة الثانية
- **جاهز الآن:** كل `charge` يحمل `amount_excl_vat`, `vat_rate`, `vat_amount`, `charge_type`، و`organization` تحمل `cr_number`/`vat_number`. الإيجار السكني مُصنَّف منفصلاً عن التجاري (معالجة ضريبية مختلفة).
- **الإضافة لاحقاً بلا ترحيل:** جدول `invoice`(`org_id`, `buyer` من `party`, `issue_ts`) و`invoice_line` يرجع إلى `charge` **الموجودة** (لا نُعيد حساب تاريخ)؛ حقول ZATCA (UUID, hash/PIH, QR/TLV, ICV, XML) في `invoice` + عمود `zatca` jsonb أو أعمدة مضافة على صفوف جديدة فقط. لأن الأساس الضريبي محفوظ على كل استحقاق منذ اليوم الأول، الفاتورة تُبنى فوق بيانات قائمة.

### ب) التحصيل الإلكتروني (مدى / Apple Pay عبر Moyasar أو Tap)
- **جاهز الآن:** `payment.method` يضم `mada`/`apple_pay`/`sadad`، و`payment`↔`payment_allocation` يسمحان بالتحصيل الجزئي والمخصَّص، و`payment_status` يُظهر الائتمان غير المخصَّص.
- **الإضافة لاحقاً:** جدول `payment_intent`/`gateway_event`(`provider`, `provider_ref`, `status`, `raw` jsonb, `payment_id`?) يُنشئ صف `payment` عند التأكيد ويُطابقه على الاستحقاقات — دون تغيير `charge`/`contract`.

### ج) بوابة الملّاك وكشوف الحساب
- **جاهز الآن:** `owner`+`party.identity_id` (يُملأ بدعوة)، و`management_agreement` (نموذج الأتعاب + سياسة التوريد الزمنية)، والاستحقاقات/التخصيصات تربط كل ريال بعقار/وحدة/عقد.
- **الكشف = استعلام مشتق** فوق `charge_balance` × `management_agreement` (نسبة/ثابت/لكل وحدة) خلال فترة → **بلا جداول جديدة إلزامية**. الوصول: دور `owner` على `party` عبر دعوة، وسياسات قراءة مقيّدة بالمالك تُضاف كـ policy لا كـ migration للبيانات.

### د) بوابة المستأجر
- **جاهز الآن:** `tenant`+`party.identity_id` (بدعوة، لا ربط تلقائي)، و`contract`/`charge`/`payment` مرتبطة بالمستأجر.
- **الإضافة لاحقاً:** سياسات RLS للقراءة للمستأجر (عقوده/استحقاقاته فقط) عبر `party.identity_id = auth.uid()` — سياسات فقط، لا ترحيل.

### هـ) إشعارات واتساب/SMS
- **جاهز الآن:** كل الأرقام E.164 نظيفة في **كل** الجداول (`identity`/`party`/`invitation`)، و`sms_outbox` يجرّد المزوّد.
- **الإضافة لاحقاً:** `notification_outbox`(`channel`∈{sms,whatsapp}, `template`, `to_e164`, `payload`, `status`) على نفس نمط `sms_outbox` — الأرقام جاهزة فلا تنظيف رجعي.

### و) الشقق المفروشة والحجوزات اليومية
- **جاهز الآن:** `unit.current_status` يضم `reserved`، و`unit_status_history` يوثّق الإشغال الزمني، و`charge_type`/`payment` عامّة تكفي الرسوم الليلية.
- **الإضافة لاحقاً:** `reservation`(`unit_id`, `guest` من `party`, `check_in/out`, `nightly_rate_halalas`) و`rate_plan` كجداول جديدة تُشير إلى `unit` القائمة؛ الحجز يولّد `charge`/`payment` بنفس المسار المالي — دون تغيير الوحدات أو العقارات.

---

## 7) ملاحظات تشغيلية | Operational notes
- **سياق المنظمة:** فعّل `pgrst.db_pre_request` أو مرّر ترويسة `x-active-org` من طبقة التطبيق؛ لا تضع `org_id` في الـ JWT.
- **الأسرار:** `ALTER DATABASE … SET app.otp_pepper='…'` (لا تترك القيمة الافتراضية). مزوّد الرسائل يقرأ `sms_outbox` ثم يمسحه بعد الإرسال (`purge_after`).
- **الوقت:** خزّن UTC؛ اعرض `Asia/Riyadh`؛ املأ `*_hijri` عند طباعة العقد.
- **الحذف:** استخدم أعمدة soft-delete؛ لم نمنح `DELETE` للجداول الأساسية أصلاً (حذف صلب متعذّر للأدوار العادية).
