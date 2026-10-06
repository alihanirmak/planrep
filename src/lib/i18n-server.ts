// Sunucu tarafi (route handler / server component) locale cozumleme.
// Ayri dosyada tutulur: "next/headers" sadece sunucuda calisabilir, bunu
// lib/i18n.ts icine koymak o dosyayi import eden tum client component'leri
// (reports/page.tsx, dashboards/page.tsx, vb.) build-time hatasina dusurur.
import { cookies } from "next/headers";
import { getT, LOCALE_COOKIE, type Locale } from "./i18n";

export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  return store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "tr";
}

export async function getServerT() {
  const locale = await getServerLocale();
  return { locale, t: getT(locale) };
}
