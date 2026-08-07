/** @type {import('next').NextConfig} */

// Content-Security-Policy. Kept narrow on purpose: the only third parties this product talks to are
// Supabase (data + auth) and Moyasar (hosted checkout), and checkout happens on Moyasar's own page,
// so nothing here needs to frame or script from them.
//
// 'unsafe-inline' on style-src is required by Next.js, which inlines critical CSS. 'unsafe-eval' is
// NOT granted — only the dev overlay needs it, and these headers are production-only (see below).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Supabase REST/Realtime over https + wss. No wildcard host: a stolen token is worth much less if
  // the page it was stolen from cannot post it anywhere.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "form-action 'self' https://api.moyasar.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Redundant with frame-ancestors on modern browsers; kept for older ones.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in this product uses a camera, a microphone or location.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Two years, subdomains included. Only meaningful over HTTPS, which production always is.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig = {
  reactStrictMode: true,
  // The Supabase Edge Function + Deno tests live under supabase/ and must not be bundled by Next.
  // (./analysis/** used to be listed here too; it moved to its own repo on 6 Aug 2026.)
  outputFileTracingExcludes: {
    '*': ['./supabase/**'],
  },
  async headers() {
    // Dev needs 'unsafe-eval' for the React refresh runtime and the error overlay. Rather than widen
    // the shipped policy so that dev keeps working, the headers simply do not apply in dev — what
    // ships is the whole point of the policy.
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
