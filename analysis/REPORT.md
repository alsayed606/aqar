# تحليل المنافسين لمنصة إدارة الأملاك SaaS | Competitive Analysis — Saudi Property-Management SaaS

**تاريخ التحليل | Analysis date:** 20–21 July 2026
**المنافسون | Targets:** Diiwan Amlak (diiwan.com) · Rawaf Amlak (amlak.rawaf.ai) · Amlak One (amlak.one)

---

## المنهجية والأدلة | Methodology & Evidence

- Crawled with Playwright headless Chromium (viewport 1440×900 desktop + 390×844 mobile), `locale: ar-SA`, ≥2.2 s delay between pages, robots.txt Disallow rules respected. Public pages only; no accounts created, no forms submitted, no API probing beyond what pages load themselves.
- Evidence per page saved in `./analysis/<site>/`: full-page JPEG screenshot (`<slug>.jpg`), rendered text (`<slug>.txt`), metadata manifest (`pages.json`), crawl overview (`summary.md`), raw no-JS HTML shell (`home.raw.html`), response headers, robots.txt / sitemap.xml where present. Mobile captures end in `.mobile390.jpg`.
- Crawler source: [crawler.js](crawler.js) (re-runnable: `node crawler.js <siteKey> <url> <outDir>`).
- Coverage: Diiwan 22 pages, Rawaf 22 pages, Amlak One 23 pages. No site blocked headless access.
- **Limits of evidence:** public marketing surfaces only — in-app depth is inferred from marketing claims, robots.txt app routes, and pricing feature lists. "✗" in the matrix means *not advertised publicly*, not proven absence.

---

# الملفات التفصيلية لكل منافس | Per-Competitor Profiles

## 1) ديوان أملاك | Diiwan Amlak — diiwan.com

### 1.1 مخزون الميزات | Feature inventory
Evidence: `diiwan.com/home.txt`, `packages.jpg`, `custom-package.txt`.

- إدارة العقارات والوحدات (property/unit limits per plan: عدد العقارات المُدارة / عدد الوحدات المُدارة)
- متابعة المستأجرين (tenant tracking — no tenant *portal* advertised)
- أتمتة تحصيل الإيجارات (rent-collection automation — no gateway named)
- التقارير: تقارير العقارات، التقارير التشغيلية، التقارير المالية + تصدير PDF/Excel
- نظام طلبات صيانة مبسَّط + إضافة مزود خدمة
- التذكيرات الدورية، الإحصائيات الدورية، المهام اليومية، قائمة المفضلة
- التحكم بصلاحيات المشرفين (multi-user roles, 1–10 users by plan)
- برنامج المسوقين بالعمولة مع محفظة أرباح (affiliate/referral program — `marketing.jpg`)
- باقة مخصصة: builder لاختيار الميزات والحدود يدوياً (`custom-package.jpg`)
- Payment-method logos in footer: **mada, Apple Pay, Visa, Mastercard** (`register.jpg` footer); SADAD referenced in refund terms (`terms-conditions.txt` line "سداد")

### 1.2 هيكل المعلومات | Information architecture
```
diiwan.com
├── / (الرئيسية)            ├── /packages (الباقات)
├── /about (عن ديوان)       ├── /custom-package (باقة مخصصة)
├── /marketing (المسوقين)   ├── /contact (تواصل معنا)
├── /terms-conditions        ├── /help (المساعدة)
└── auth: /register → /login → /forget-password
```
Signup flow (up to account creation): `أنشئ حساب جديد` → single form: الاسم، البريد الإلكتروني، الجوال، كلمة المرور، تأكيد كلمة السر (`register.jpg`). Self-serve, no email-first verification step visible, no plan selection during signup; plans are "طلب الباقة" (request-based) afterwards.
Note: guessed routes (/pricing, /features, /blog, /faq, /privacy) all return the SPA shell with HTTP 200 and ~272 chars of nav text — they do not exist as real content (soft-404 behaviour).

### 1.3 التسعير | Pricing & packaging
Evidence: `packages.jpg`, `packages.txt`. Billing tabs: شهر / ربع سنوي / نصف سنوي / عام.

| الباقة | السعر الشهري المعروض | الحدود | ملاحظات |
|---|---|---|---|
| باقة ديوان | 60 (SAR symbol shown; DOM text "$") | 1 مستخدم · 10 عقارات · 50 وحدة | "أفضل عرض", خصم 60% |
| الباقة المميزة | 190 | 10 مستخدمين · 300 عقار · 500 وحدة | "الأكثر شعبية", خصم 62% |
| باقة النخبة (VIP) | تواصل معنا | غير معلنة | dedicated tools + priority support |
| باقة مخصصة | حسب الاختيار | builder | feature-by-feature composition |

No free trial advertised. Permanent "discount" framing (60–62%) is promotional anchoring. Refund policy: 7-day request window, **up to 60 days** to process (`terms-conditions.txt`).

### 1.4 الشرائح المستهدفة | Target segments
Landlords & individual investors ("للملاك والمستثمرين", `about.txt`); property managers implicitly via multi-user plans; affiliates/marketers as a growth channel. **No tenant portal, no owner portal, no broker features advertised.**

### 1.5 البصمة التقنية | Tech fingerprint
- Vite-bundled CSR SPA (`/assets/index-*.js`, CSS modules — `summary.md` script list); React-family component naming.
- Hosting: `server: nginx/1.24.0 (Ubuntu)` — self-managed VPS, no CDN.
- Third-party requests: **Google Fonts only. Zero analytics** (no GA/GTM/pixels) — they cannot measure their own funnel.
- Rendering: pure CSR — raw no-JS shell is **1.5 KB** (`home.raw.html`); every route serves the same static `<title>Diiwan Amlak</title>` and English meta description.

### 1.6 إشارات الثقة والامتثال | Trust & compliance signals
- ❌ No CR number, no VAT number, no legal company name (footer: "فريق عمل ديوان").
- Address: "المملكة العربية السعودية" only. Phone +966143544454, support@diiwan.com.
- Terms mention ZATCA only for VAT-refund mechanics and SADAD as a payment channel; ❌ no ZATCA e-invoicing feature, ❌ no PDPL mention, ❌ no standalone privacy policy (combined terms page).

### 1.7 وضع السيو | SEO posture
Effectively unindexable content: CSR empty shell, one static title/meta site-wide (meta in English on an Arabic site), no sitemap.xml, no canonical, no hreflang, no blog (route is an empty shell). Score: **1/10**.

### 1.8 تقييم تجربة الاستخدام | UX score: **5/10**
- Value prop clear but generic ("إدارة أذكى حياة أسهل").
- Packages page is genuinely polished (`packages.jpg`); registration clean (`register.jpg`).
- Homepage relies on scroll-triggered animations; full-page capture shows large blank regions (`home.jpg`, `home.mobile390.jpg`) — fragile, and hero → footer with sparse content (1,690 chars total).
- RTL layout correct (`dir=rtl`); Arabic copy has typos ("أقصي", "المدفوعه", "القاهره" style spellings in terms).
- Mobile 390px renders correctly (`home.mobile390.jpg`, `pricing.mobile390.jpg`).
- Currency ambiguity ($ in DOM vs riyal glyph rendered) and "request package" instead of instant checkout add friction.

---

## 2) رواف أملاك | Rawaf Amlak — amlak.rawaf.ai

### 2.1 مخزون الميزات | Feature inventory
Evidence: `amlak.rawaf.ai/landing.txt`, `pricing.txt`, `landing.jpg`, `pricing.jpg`.

- نظام إدارة الأملاك والمستأجرين; إدارة العقود والدفعات; إدارة الإيرادات والمصروفات
- الفواتير + **تصدير الفاتورة الضريبية (المرحلة الأولى والثانية)** — ZATCA Phase 1 & 2 invoice export, **Platinum tier only**
- إدارة الصيانة والمستندات (تخزين المستندات بجميع أنواعها، إرفاق مستندات للمهام)
- لوحة التقارير الشاملة: إيرادات/مصاريف، **نسب الشغول** (occupancy), تقارير الاستثمار، تصدير إكسل، تصدير عروض الأسعار الإيجارية
- التحليلات والإشعارات + **إشعار المستأجرين SMS**; إشعار تذكير المهام
- البوابات: **بوابة دخول المستأجرين** (Silver+), **بوابة دخول الملاك والمؤجرين** (Gold+), **بوابة دخول الوكلاء والوسطاء** (Gold+)
- إدارة المستخدمين والصلاحيات; إدارة كافة المهام (تشغيلية ومالية); خريطة تفاعلية للعقارات
- Platinum extras: مدير حساب مخصص، الهوية الخاصة بالشركة (own branding)
- Business tier: إدارة النقد والرصيد، إسناد العقارات لمستخدمين، لوحات مخصصة، **الربط التقني مع الأنظمة الداخلية** (custom integrations), تطوير خدمات جديدة
- حساب تجريبي عام للتصفح ("تصفح الحساب الافتراضي") + تجربة مجانية 14 يوم (`pricing.jpg` hero)
- Same-origin web app (robots.txt disallows /dashboard, /properties, /tasks, /contacts, /archive, /profile, /PaymentStatus)

### 2.2 هيكل المعلومات | Information architecture
```
amlak.rawaf.ai
├── /landing (الرئيسية — / redirects here)
├── /pricing (الأسعار)      ├── /about (عن رواف)
├── /contact (تواصل معنا)   ├── /blogs → /blog/<12+ SEO articles>
├── legal: /TermsOfUse · /PrivacyPolicy · /RefundPolicy
└── auth: /login (tabs: تسجيل الدخول | إنشاء حساب via ?section=register)
```
Signup: single `/login?section=register` page, H1 "إنشاء حساب". Top-bar CTA "تواصل مع فريق المبيعات" + "احجز موعد مع فريق المبيعات" (sales-assisted motion alongside self-serve trial). WhatsApp floating button on every page.

### 2.3 التسعير | Pricing & packaging
SAR, **شاملة ضريبة القيمة المضافة** (VAT-inclusive). Monthly/annual toggle, annual saves 20%. 14-day free trial on all tiers.

| الباقة | شهرياً | سنوياً | وحدات | مستخدمون | وكلاء | مميزات مفصلية |
|---|---|---|---|---|---|---|
| الفضية | 92 SAR | 1,380→1,099 | 60 | 2 | — | tenant portal, contracts & payments, SMS, docs, dashboards |
| الذهبية | 298 SAR | 4,464→3,575 | 300 | 5 | 5 | + owner portal, broker portal, permissions, investment reports, 24/7 support |
| البلاتينية | 436 SAR | 6,528→5,225 | 600 | 15 | 10 | + **ZATCA Phase 1+2 export**, Excel export, account manager, own branding |
| الأعمال | اطلب تسعيرة | — | حسب الطلب | حسب الطلب | حسب الطلب | cash mgmt, custom dashboards, internal-system integrations |

### 2.4 الشرائح المستهدفة | Target segments
Broadest of the three: ملاك (owners), مديرو العقارات ومكاتب إدارة الأملاك (managers/offices), المستأجرون (portal), **الوكلاء والوسطاء (brokers — explicit portals and per-plan agent seats)**. Enterprise via Business tier.

### 2.5 البصمة التقنية | Tech fingerprint
- React + webpack CSR SPA (numeric hashed chunks); **not** Next/Nuxt (no framework markers, raw shell 3.5 KB).
- Hosting `nginx/1.20.1`; static assets on **DigitalOcean Spaces (fra1** — Frankfurt); some blog images hot-linked from `lh7-rt.googleusercontent.com` (Google-Docs-hosted images).
- Heavy ad/analytics stack on every page: **GTM (GTM-5L39XD8K), GA4 (G-S6NDW4JR8L), Hotjar, TikTok pixel, Snapchat pixel, Google Ads conversion** (`summary.md` third-party hosts) → paid-acquisition driven growth.
- Per-route titles/descriptions set client-side (CSR SEO, fragile for non-Google crawlers).

### 2.6 إشارات الثقة والامتثال | Trust & compliance signals — الأقوى | strongest
- Footer on every page: "مدار من قبل **شركة أجر لتقنية المعلومات** — سجل تجاري **1010777174** — الرقم الضريبي **311172320100003**".
- Physical address: مجمع ريادة الأعمال — واجهة الرياض، الرياض 13413. Phone/WhatsApp 0594362853, amlak-care@rawaf.ai.
- Full legal trio (استخدام/خصوصية/إلغاء واسترجاع) with ZATCA-aware VAT refund language. ZATCA e-invoicing *as a product feature* (Platinum). ❌ No explicit PDPL reference.

### 2.7 وضع السيو | SEO posture
Best *content* strategy: sitemap.xml (25 URLs), configured robots.txt, unique keyword-targeted titles/descriptions, **12+ Arabic SEO articles** squarely targeting "برنامج إدارة أملاك / برنامج متابعة الإيجارات / نظام إدارة الأملاك…" money keywords. Weaknesses: CSR rendering; duplicate case-variant URLs (/TermsOfUse vs /termsofuse) rendering without titles → duplicate content; multiple H1s per blog page; no hreflang despite EN toggle; no canonical tags. Score: **6/10**.

### 2.8 تقييم تجربة الاستخدام | UX score: **7/10**
- Professional, coherent purple identity; product mockups + video on landing (`landing.jpg`); demo account lowers evaluation friction; WhatsApp button everywhere.
- Mobile 390px clean and fully RTL (`home.mobile390.jpg`, `pricing.mobile390.jpg`).
- Deductions: `<html dir>` not set (`dir=null` on all pages — CSS-only RTL); Arabic typos in prominent UI ("نتبيهات", "إبدء", "مشارك المستندات الملفات"); pricing feature-lists mix nouns/verbs inconsistently; inner-scroll layout breaks native full-page capture and browser scroll restoration.

---

## 3) أملاك ون | Amlak One — amlak.one

### 3.1 مخزون الميزات | Feature inventory
Evidence: `amlak.one/home.txt`, `real-estate.txt`, `service-providers.txt`, `marketing.txt`, `browse.jpg`, `pricing.jpg`.

- إدارة العقارات والوحدات + تقارير الإشغال والإيرادات
- **عقود الإيجار الذكية** مع تنبيهات التجديد والمتابعة التلقائية; تتبع المدفوعات
- **نظام الحجوزات** — "إدارة الوحدات الفندقية والحجوزات اليومية مع تقويم مرئي" (short-stay/furnished!)
- **معارض الوحدات العامة** (public interactive unit showcases) + سوق عام /browse: بحث، خريطة (OpenStreetMap)، فلاتر شراء/إيجار/حجز إقامة/تأجير (`browse.jpg` — currently ~1 live listing)
- For service providers: صندوق وارد الطلبات، إدارة المنتجات والخدمات، **الفواتير والمدفوعات**، قاعدة العملاء، تقارير الأداء، التواصل مع شركات العقارات
- For marketing companies: معارض تفاعلية، نظام طلبات المستأجرين، **عقود التسويق**، لوحة تحكم التسويق، مشاركة المعارض، **تقارير التحويل** (conversion)
- تقارير وتحليلات متقدمة; الرسائل (messages module in product nav); إدارة الموظفين (robots.txt /employees)
- Live product preview embedded on homepage (units, occupancy %, cities — `home.txt`)
- App routes (robots.txt): /dashboard, /platform, /settings, /employees, /invite, /apply, /application, /properties, /tenants, /services, /reports, /contracts

### 3.2 هيكل المعلومات | Information architecture
```
amlak.one (ar default, /en mirror with hreflang)
├── /            ├── /pricing      ├── /about
├── /real-estate ├── /service-providers ├── /marketing   (3 solution pages)
├── /browse (سوق عقارات عام + خريطة)
├── /blog (— "قريباً" coming soon)  ├── /contact  ├── /support (+?topic=technical|billing|security)
└── legal: privacy, terms · auth: login / register (robots-disallowed)
```
Signup CTA: "ابدأ مجاناً" everywhere → /register (disallowed to crawlers; not entered per rules). Onboarding motion is pure product-led free plan; support form with topic routing.

### 3.3 التسعير | Pricing & packaging
"خطط بسيطة وشفافة — ابدأ مجاناً وإختار الترقية حسب احتياجك". Per-segment tabs (شركات العقارات / مزودو الخدمات / شركات التسويق) but currently a **single permanent-free plan** ("أعمال — مجاناً") per segment (`pricing.jpg`). FAQ commits to: permanent free tier, local+international payment methods, monthly/annual with annual discount, cancel anytime, 30-day data retention post-cancel, data-migration help. Paid tiers not yet published → pre-monetization stage (traction band: +74 شركة, +330 وحدة, +5 مدن — `home.jpg`).

### 3.4 الشرائح المستهدفة | Target segments
Three-sided B2B: شركات العقارات (portfolio managers), مزودو الخدمات (maintenance vendors), شركات التسويق العقاري (marketing agencies/brokers-adjacent) — plus tenants as consumers of public showcases/marketplace. Explicitly hotel/daily-rental units too.

### 3.5 البصمة التقنية | Tech fingerprint
- **Next.js (Turbopack chunks, `x-powered-by: Next.js`) with real SSR** — raw no-JS homepage is 443 KB of content (`home.raw.html`).
- **Cloudflare** CDN/hosting (cf-ray DMM = Dammam edge) + Cloudflare Insights (only tracker). OpenStreetMap tiles for /browse.
- Proper per-page canonical + hreflang (ar/en/x-default). Full English mirror under /en.

### 3.6 إشارات الثقة والامتثال | Trust & compliance signals
- ❌ No CR, no VAT number, no physical address, no phone (support form only) — weakest legal disclosure.
- ✅ Privacy policy + terms; security-topic support lane; SSL/data-safety claims in FAQ; named-company testimonials.
- ❌ No ZATCA mention anywhere; ❌ no PDPL mention.

### 3.7 وضع السيو | SEO posture
Technically the best foundation: SSR HTML, unique bilingual metadata, canonicals, hreflang, sitemap (25 URLs), clean robots.txt. But near-zero content marketing: blog = "قريباً", no articles, marketplace almost empty. Bugs: `/en/unit/1-1` returns **500**; `/en/real-estate`, `/en/service-providers`, `/en/marketing` render with `lang=ar dir=rtl` (i18n attribute bug — `summary.md`). Score: **7/10** (engine excellent, fuel missing).

### 3.8 تقييم تجربة الاستخدام | UX score: **7.5/10**
- Most modern design of the three: editorial black/cream, excellent Arabic typography, real product preview, per-segment storytelling with pain-points ("التواصل مع المستأجرين عبر واتساب بدون نظام").
- Mobile 390px flawless (`home.mobile390.jpg`); full EN version.
- Deductions: pricing page is one lonely free card (undermines "plans" promise); marketplace has ~1 listing (empty-state credibility risk); 500 on public unit page; EN sub-pages direction bug; traction numbers honest but small.

---

# المقارنة والتحليل | Synthesis

## مصفوفة مقارنة الميزات | Feature Comparison Matrix
(✓ advertised · ◐ partial/tier-gated · ✗ not advertised publicly)

| الميزة | Feature | Diiwan | Rawaf | Amlak One |
|---|---|:---:|:---:|:---:|
| إدارة العقارات والوحدات | Property & unit mgmt | ✓ | ✓ | ✓ |
| عقود الإيجار وتجديدها | Lease contracts & renewals | ◐ (implicit) | ✓ | ✓ |
| الفوترة والمدفوعات | Invoicing & payment tracking | ◐ | ✓ | ✓ |
| فاتورة ZATCA (المرحلة 2) | ZATCA Phase-2 e-invoice | ✗ | ◐ (Platinum 436 SAR only) | ✗ |
| تحصيل إيجارات إلكتروني معلن (مدى/أبل باي للمستأجر) | Advertised tenant rent-payment rails | ✗ | ✗ | ✗ |
| طلبات الصيانة | Maintenance requests | ✓ | ✓ | ✓ (via service providers) |
| بوابة المستأجر | Tenant portal | ✗ | ✓ | ◐ (requests via showcases) |
| بوابة الملاك | Owner portal/statements | ✗ | ◐ (Gold+) | ✗ |
| بوابة الوكلاء/الوسطاء | Broker/agent portal | ✗ | ◐ (Gold+) | ✗ |
| إشعارات SMS | SMS notifications | ✗ | ✓ | ✗ |
| إشعارات واتساب | WhatsApp notifications | ✗ | ✗ (support channel only) | ✗ |
| تقارير مالية وإشغال | Financial & occupancy reports | ✓ | ✓ | ✓ |
| تصدير PDF/Excel | PDF/Excel export | ✓ | ◐ (Excel Platinum) | ✗ |
| إدارة المستندات | Document management | ✗ | ✓ | ✗ |
| إدارة المهام | Task management | ✓ | ✓ | ✗ |
| الحجوزات اليومية/الفندقية | Short-stay/daily reservations | ✗ | ✗ | ✓ |
| سوق/معارض وحدات عامة | Public marketplace/showcases | ✗ | ✗ | ✓ |
| إدارة مزودي الخدمات كطرف | Service-provider side | ◐ (add vendor) | ✗ | ✓ |
| عقود وشركات التسويق | Marketing-company module | ✗ (affiliate only) | ✗ | ✓ |
| صلاحيات وتعدد مستخدمين | Roles & multi-user | ✓ | ✓ | ✓ (employees) |
| تكامل مع أنظمة (API) | Integrations/API | ✗ | ◐ (Business, bespoke) | ✗ |
| تكامل منصة إيجار | Ejar integration | ✗ | ✗ | ✗ |
| تطبيقات جوال (متاجر) | Native mobile apps | ✗ | ✗ | ✗ |
| خطة مجانية / تجربة | Free plan / trial | ✗ (none) | ◐ (14-day trial + demo) | ✓ (free forever) |
| تسعير معلن شفاف | Transparent public pricing | ◐ ($/SAR ambiguity) | ✓ | ◐ (free only) |
| ثنائية اللغة فعلياً | True AR/EN bilingual | ✗ | ◐ (toggle, AR-only content) | ✓ |
| سجل تجاري + رقم ضريبي معلن | Public CR + VAT number | ✗ | ✓ | ✗ |
| ذكر PDPL | PDPL mention | ✗ | ✗ | ✗ |
| SSR / محتوى قابل للفهرسة | SSR/indexable content | ✗ | ✗ | ✓ |
| مدونة SEO نشطة | Active SEO blog | ✗ | ✓ (12+ articles) | ✗ (coming soon) |

## تحليل الفجوات | Gap Analysis — ما لا يخدمه أحد جيداً
1. **تكامل منصة إيجار (Ejar)** — zero mentions across all three sites. Any Saudi residential lease legally flows through Ejar; native sync/export is an unowned, high-trust feature.
2. **ZATCA Phase 2 للجميع** — only Rawaf has it, gated at 436 SAR/mo. Nobody offers compliance as a baseline right.
3. **تحصيل الإيجار عبر مدى/أبل باي/سداد للمستأجر** — all three track payments; none advertises actual tenant-facing collection rails with automatic receipts.
4. **مشغّلو الشقق المفروشة والإيجار اليومي** — only Amlak One touches reservations, without channel management, seasonal pricing, or check-in workflows. Diiwan/Rawaf ignore the segment entirely — and it is one of your three target personas.
5. **إشعارات واتساب** — Rawaf sells SMS; Amlak One names WhatsApp chaos as a *pain*; nobody sells WhatsApp Business API notifications (the default communication medium in KSA).
6. **PDPL والثقة الأمنية** — no PDPL, MFA, audit-log, or data-residency statements anywhere. A real "مركز الثقة" (trust center) page would be unique in this set.
7. **الذكاء الاصطناعي لاستخراج المستندات** — no AI contract/deed OCR, auto-ingestion of صكوك/عقود, or smart data entry anywhere (despite Rawaf's ".ai" domain).
8. **SSR + محتوى معاً** — Rawaf has content on a CSR stack; Amlak One has SSR with no content; Diiwan has neither. The combination is vacant.
9. **تقارير للملاك في الباقات الدنيا** — owner statements are Gold+ (298 SAR) at Rawaf, absent elsewhere.
10. **تطبيقات جوال أصلية** — no App Store/Play links found on any site.

## نقاط ضعفهم القابلة للاستغلال | Weaknesses to Exploit
- **Diiwan:** invisible to search (static single meta, no sitemap, CSR shell); no legal identity (no CR/VAT/company name); no trial; "طلب الباقة" friction; currency ambiguity; no measurement stack at all (they are flying blind — they can't even A/B respond to competition).
- **Rawaf:** CSR undermines its own SEO spend (paid pixels everywhere = expensive CAC); ZATCA gated to top tier; Arabic typos in premium-priced UI; `dir` attribute missing; duplicate-URL/meta hygiene issues; assets on Frankfurt DO Spaces (latency + data-residency optics); Google-Docs-hosted blog images.
- **Amlak One:** pre-monetization (free-only) — revenue-model uncertainty you can attack with "serious infrastructure for serious operators"; empty marketplace and blog; 500 errors + i18n direction bugs on EN pages; anonymous operator (no CR/VAT/address/phone) — weak for enterprise trust; small disclosed traction (74 companies).

## قائمة ميزات MVP ذات أولوية | Prioritized MVP Feature List
Derived from matrix table-stakes (all-✓ rows), the gap analysis, and your constraints (Next.js SSR + Supabase RLS multi-tenancy, Moyasar/Tap).

**Must (الإطلاق | launch):**
- إدارة العقارات والوحدات + المستأجرين (table stakes — all three have it)
- عقود إيجار مع تنبيهات تجديد + قوالب متوافقة مع نموذج إيجار (Ejar-aligned fields from day 1)
- الفوترة + **فاتورة ZATCA المرحلة الثانية مدمجة في كل الباقات** (QR/XML, Fatoora API) — turns Rawaf's premium gate into your baseline
- تحصيل الإيجار أونلاين: **Moyasar أو Tap — مدى وApple Pay** + إيصالات تلقائية وروابط دفع (nobody advertises this)
- طلبات الصيانة مع تعيين مزود خدمة
- تقارير مالية وإشغال + تصدير PDF/Excel (Diiwan gives export cheaply; don't gate it high)
- بوابة مستأجر (Rawaf has it at 92 SAR — it's table stakes) + إشعارات **واتساب/SMS** للدفعات والتجديد
- أمن وامتثال أساسي: MFA، سجل تدقيق، عزل بيانات لكل منظمة عبر Supabase RLS، صفحة PDPL/مركز ثقة عربي
- عربي-أولاً RTL حقيقي (`<html dir="rtl">` — Rawaf forgets the attribute) + تعريب سليم خالٍ من الأخطاء (both competitors have typos)
- موقع تسويقي Next.js SSR بميتاداتا لكل صفحة + sitemap + hreflang (بنية أملاك ون، التي لا يملك ديوان ورواف مثلها)

**Should (بعد الإطلاق بربع | next quarter):**
- بوابة الملاك مع كشوف حساب دورية — **in the entry tier**, undercutting Rawaf's Gold gating
- وحدة الشقق المفروشة: تقويم حجوزات يومية، أسعار موسمية، تجهيز/تنظيف بين الحجوزات (only Amlak One partially covers this; it is your furnished-operator persona)
- استخراج ذكي للمستندات بالذكاء الاصطناعي: قراءة صك/عقد/هوية وتعبئة البيانات تلقائياً (vacant across all three, credible via Edge Functions + OCR/LLM)
- مدونة عربية SEO تستهدف نفس كلمات رواف المفصلية ("برنامج إدارة أملاك"، "برنامج متابعة الإيجارات"، "نظام إدارة الأملاك"…) — your SSR beats their CSR on identical queries
- استيراد بيانات بمساعدة (Excel → منصة) — Amlak One promises it; make it self-serve
- تجربة مجانية 14 يوم + حساب تجريبي عام (copy Rawaf's demo-account move) بدون بطاقة

**Later (خارطة الطريق | roadmap):**
- تكامل رسمي/تصدير متوافق مع **منصة إيجار** حين تتاح القنوات (وحتى ذلك الحين: مواءمة الحقول والقوالب)
- بوابة وكلاء/وسطاء وعمولات؛ برنامج إحالة (Diiwan's affiliate idea, executed with tracking)
- معارض وحدات عامة/روابط تسويقية قابلة للمشاركة (Amlak One's showcase concept) مع صفحات SSR قابلة للفهرسة لكل وحدة — becomes an SEO moat
- تطبيقات جوال (PWA أولاً ثم متاجر) — nobody has them
- API عامة + Webhooks (Rawaf sells bespoke integration at Business tier; make it self-serve)
- ربط سداد/التحصيل البنكي والتسويات؛ محاسبة أعمق (شجرة حسابات، إشعارات دائن/مدين متوافقة مع ZATCA)

## عوامل التمايز الموصى بها | Recommended Differentiators
1. **"الامتثال ليس باقة" — Compliance-as-baseline.** ZATCA Phase 2 + PDPL + audit log in every tier. Rationale: Rawaf prices compliance at 436 SAR/mo; Diiwan/Amlak One ignore it; regulation makes this a non-optional purchase criterion — winning it at 99 SAR reframes the whole market.
2. **التحصيل الفعلي للإيجار (مدى/Apple Pay عبر Moyasar/Tap) مع إيصال + فاتورة ضريبية تلقائية.** Rationale: all competitors *track* payments; none *collects* them. Payment rails + ZATCA receipts close the landlord's actual job-to-be-done and create transaction stickiness.
3. **الشقق المفروشة كشريحة من الدرجة الأولى.** Booking calendar, nightly pricing, housekeeping turnovers. Rationale: matrix shows it as a one-competitor (partial) row, and it's a named persona of yours with higher ARPU and urgency.
4. **واتساب أولاً للتواصل.** Contract renewals, payment reminders, maintenance updates via WhatsApp Business API. Rationale: KSA's default channel; competitors offer SMS at best and one *names WhatsApp chaos as the problem* without solving it.
5. **SSR عربي + محتوى — امتلاك القناة المجانية.** Next.js marketing site + unit-showcase pages + blog targeting Rawaf's exact keyword set. Rationale: Rawaf proves the demand (12 SEO articles + heavy paid pixels = they pay for what you can rank for); their CSR stack and Amlak One's empty blog leave the organic channel winnable.
6. **هوية قانونية وثقة معلنة من اليوم الأول.** CR + VAT + address in the footer, PDPL trust page, uptime/status page. Rationale: only Rawaf discloses identity; your enterprise/manager segment buys trust, and it costs nearly nothing.
7. **الذكاء الاصطناعي العملي (استخراج العقود والصكوك).** Rationale: unclaimed by all three; converts onboarding (the #1 switching cost — bulk data entry) into a wow moment; feasible with Supabase Edge Functions + OCR/LLM on your stack.

### مقارنة تسعير سريعة للتموضع | Pricing benchmark for positioning
- Rawaf: 92 / 298 / 436 SAR شهرياً (شاملة الضريبة) بحدود وحدات 60/300/600.
- Diiwan: 60 / 190 (عملة معروضة بالريال، DOM بالدولار) بحدود 50/500 وحدة.
- Amlak One: مجاني حالياً.
→ التموضع المقترح: خطة مجانية مقيدة (تحييد أملاك ون) ثم ~99 و~299 SAR بحدود وحدات أعلى من رواف عند كل نقطة سعر، مع إبقاء ZATCA والتحصيل وبوابة الملاك في *كل* الخطط والتمايز بالحدود والأتمتة والذكاء الاصطناعي.

---

## فهرس الأدلة | Evidence Index
Every claim above cites files under `./analysis/<site>/`:
- `summary.md` — per-page status, titles, metas, headings, framework flags, third-party hosts
- `pages.json` — machine-readable manifest (incl. homepage response headers)
- `<slug>.jpg` / `<slug>.mobile390.jpg` — desktop 1440px & mobile 390px screenshots
- `<slug>.txt` — rendered text (first line = URL)
- `home.raw.html` + `home.headers.json` — no-JS shell & headers (CSR/SSR proof)
- `robots.txt`, `sitemap.xml` — where the site provided them

*Report generated from a public-surface crawl on 20–21 July 2026; in-app functionality inferred from public claims only.*
