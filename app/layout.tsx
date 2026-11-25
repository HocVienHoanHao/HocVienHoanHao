import type { Metadata, Viewport } from "next";
import "./globals.css";
import { demoMode } from "@/lib/demo";

export const metadata: Metadata = {
  title: "Hoàn Hảo Football CRM",
  description: "Quản lý Học viện Bóng đá Hoàn Hảo — Quy Nhơn, Phú Yên, Phù Mỹ",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#102C46" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen font-sans antialiased">
        {demoMode() && (
          <div className="bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-navy">
            BẢN XEM THỬ · Dữ liệu giả, không phải học viên thật
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
