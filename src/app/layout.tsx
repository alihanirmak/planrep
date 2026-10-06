import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PlanRep",
  description: "Web tabanlı planlama ve raporlama platformu",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
};

// PWA icin mobil tarayici davranisi: viewport genislik cihaz genisligine
// esitlenir (yakinlastirma/kaydirma yerine responsive layout kullanilir),
// theme-color mobil tarayici adres cubugunu marka rengiyle (slate-900)
// boyar. maximumScale/userScalable KASITLI OLARAK sinirlanmadi — a11y
// icin kullanicinin yakinlastirabilmesi onemlidir, PWA "uygulama hissi"
// bu kisitlamadan daha az oncelikli.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e293b",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const locale = store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "tr";
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
