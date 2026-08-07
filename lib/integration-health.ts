import { createAdminClient } from "@/lib/supabase/admin";

// Live probes of the services this product depends on but does not contain.
//
// WHY THIS EXISTS
// The health page used to list these as "outside our measurement" — an honest note, and also a
// standing invitation to be surprised. It was: the service-role key in production was invalid, and
// the only place that said so was a Vercel log line nobody reads. Two subsystems were silently dead
// for it — the rate limiter (which fails open by design) and every scheduled job — and the e-mail
// provider was never configured at all, so not one notification had ever left the queue.
//
// A probe that ASKS is the difference between "we assume it works" and "it answered".
//
// NOTHING HERE PRINTS A SECRET. Probes report a verdict and the provider's own error text; the key
// values never leave the server, and the page that renders this is operator-only.

export type ProbeStatus = "ok" | "fail" | "unset";

export type Probe = {
  name: string;
  status: ProbeStatus;
  /** The provider's own words when it refused. Never a credential. */
  detail: string;
  /** What stops working while this is broken — the reason an operator should care today. */
  impact: string;
  /** Where to go and fix it. */
  where: string;
};

/** The service-role key, proven by USING it rather than by checking it is present. */
async function probeServiceRole(): Promise<Probe> {
  const base = {
    name: "مفتاح الخدمة (Supabase service_role)",
    impact: "بدونه تتوقّف المهام المجدولة وتصريف البريد وإشعارات بوابة الدفع، ويُعطَّل حدّ محاولات الدخول (يمرّ كل شيء).",
    where: "Vercel ← Settings ← Environment Variables ← SUPABASE_SERVICE_ROLE_KEY (ثم أعِد النشر)",
  };

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ...base, status: "unset", detail: e instanceof Error ? e.message : String(e) };
  }

  // Deliberately the rate limiter itself: it is service_role-only, it is the exact call that was
  // failing in production, and a limit this high means the probe can never refuse a real caller.
  // The bucket is swept with the rest after a day.
  const { error } = await admin.rpc("rate_limit_hit", {
    p_bucket: "probe:integration-health",
    p_limit: 1_000_000,
    p_window_seconds: 60,
  });
  if (error) return { ...base, status: "fail", detail: error.message };
  return { ...base, status: "ok", detail: "استُدعيت دالّة محصورة بـservice_role فاستجابت." };
}

/**
 * The e-mail provider, checked by asking Resend about the account — never by sending a message.
 * A probe that mails somebody is a probe nobody runs twice.
 */
async function probeEmailProvider(): Promise<Probe> {
  const base = {
    name: "مزوّد البريد (Resend)",
    impact: "بدونه لا يصل رمز الدخول، ولا أيّ إشعار للمكاتب — تتراكم الرسائل في الطابور بلا شكوى.",
    where: "Vercel ← Environment Variables ← RESEND_API_KEY و EMAIL_FROM · وتوثيق النطاق في Resend ← Domains",
  };

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    const missing = [!apiKey && "RESEND_API_KEY", !from && "EMAIL_FROM"].filter(Boolean).join(" و ");
    return { ...base, status: "unset", detail: `غير مضبوط: ${missing}` };
  }

  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ...base, status: "fail", detail: `resend ${res.status}: ${body.slice(0, 200)}` };
    }
    // A valid key with no verified domain still refuses to send to anyone but the account owner, so
    // "the key works" is not the whole answer and the page must not imply that it is.
    const data = (await res.json().catch(() => ({}))) as { data?: { name: string; status: string }[] };
    const verified = (data.data ?? []).filter((d) => d.status === "verified").map((d) => d.name);
    if (verified.length === 0) {
      return {
        ...base,
        status: "fail",
        detail: "المفتاح صالح، ولا نطاق مُوثَّق — لن يقبل Resend الإرسال إلا إلى بريد صاحب الحساب.",
      };
    }
    return { ...base, status: "ok", detail: `المفتاح صالح · نطاق مُوثَّق: ${verified.join(", ")} · المُرسِل: ${from}` };
  } catch (e) {
    return { ...base, status: "fail", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** The cron secret cannot be probed by calling — the call IS the job. Presence is all we can say. */
function probeCronSecret(): Probe {
  const present = Boolean(process.env.CRON_SECRET);
  return {
    name: "سرّ المهام المجدولة (CRON_SECRET)",
    status: present ? "ok" : "unset",
    detail: present ? "مضبوط. صحّته تظهر في جدول «المهام المجدولة» أعلاه." : "غير مضبوط — سيُرفض كل نداء مجدول.",
    impact: "بدونه لا يُصرَّف البريد ولا تُجدَّد الاشتراكات.",
    where: "Vercel ← Environment Variables ← CRON_SECRET",
  };
}

export async function checkIntegrations(): Promise<Probe[]> {
  const [serviceRole, email] = await Promise.all([probeServiceRole(), probeEmailProvider()]);
  return [serviceRole, email, probeCronSecret()];
}
