import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n";
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
