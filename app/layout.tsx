import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";

// Self-hosted at build time (no runtime external request, no layout shift). Applies site-wide.
const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
  variable: "--font-tajawal",
});

export const metadata: Metadata = {
  title: "عقار | منصة إدارة الأملاك والعقارات في السعودية",
  description:
    "منصة سحابية سعودية لإدارة الأملاك: العقارات والوحدات والعقود وسندات القبض وفواتير ZATCA وبوابات الملّاك والمستأجرين — متعددة المستأجرين وآمنة.",
};

// viewportFit "cover" is required for env(safe-area-inset-bottom) to report a real value; without
// it the bottom navigation would sit under the iPhone home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
