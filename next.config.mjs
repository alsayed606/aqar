/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Supabase Edge Function + Deno tests live under supabase/ and must not be bundled by Next.
  outputFileTracingExcludes: {
    '*': ['./supabase/**', './analysis/**'],
  },
};

export default nextConfig;
