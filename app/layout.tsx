import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "عقار | Aqar — منصة إدارة الأملاك",
  description:
    "منصة سعودية لإدارة الأملاك: العقارات والوحدات والعقود والمستأجرين والملّاك — متعددة المستأجرين وآمنة.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="font-sans">{children}</body>
    </html>
  );
}
