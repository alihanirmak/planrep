"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getT, LOCALE_COOKIE, type Locale, type TKey } from "@/lib/i18n";
import type { SessionUser } from "@/lib/session";
import { useEscapeKey, useFocusTrap } from "@/lib/a11y";
import NotificationBell from "./NotificationBell";

const NAV: Array<{ href: string; key: TKey; icon: string; adminOnly?: boolean }> = [
  { href: "/", key: "nav.home", icon: "🏠" },
  { href: "/reports", key: "nav.reports", icon: "📊" },
  { href: "/dashboards", key: "nav.dashboards", icon: "📈" },
  { href: "/workflow", key: "nav.workflow", icon: "✅" },
  { href: "/scenarios", key: "nav.scenarios", icon: "🔀" },
  { href: "/ai", key: "nav.ai", icon: "✨" },
  { href: "/modeling", key: "nav.modeling", icon: "🧊" },
  { href: "/browser", key: "nav.browser", icon: "🔎" },
  { href: "/upload", key: "nav.upload", icon: "📤" },
  { href: "/integrations", key: "nav.integrations", icon: "🔌" },
  { href: "/admin/users", key: "nav.users", icon: "👥", adminOnly: true },
  { href: "/admin/access", key: "nav.access", icon: "🔐", adminOnly: true },
  { href: "/admin/audit", key: "nav.audit", icon: "📜", adminOnly: true },
  { href: "/account/security", key: "nav.security", icon: "🔐" },
];

function setLocaleCookie(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000`;
}

export default function Sidebar({
  user,
  locale,
}: {
  user: SessionUser;
  locale: Locale;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const t = getT(locale);
  // Mobil kesit (< md): menu varsayilan kapali, hamburger ile acilan bir
  // "drawer" (gecici kaydirmali panel) olarak gosterilir. md ve ustunde
  // (`md:static md:translate-x-0`) her zaman gorunur, bu state'in gorsel
  // etkisi yoktur. bkz. (app)/layout.tsx — ebeveyn flex konteyner
  // mobilde dikey (flex-col), md+ icin yatay (md:flex-row) sıralanir;
  // bu aside `position: fixed` oldugundan (mobilde) normal akistan
  // cikar, dolayisiyla ustteki mobil cubukla (bu bilesenin ilk cocugu)
  // cakismaz.
  const [open, setOpen] = useState(false);
  useEscapeKey(() => setOpen(false), open);
  const drawerRef = useFocusTrap<HTMLDivElement>(open);

  function switchLocale(next: Locale) {
    setLocaleCookie(next);
    router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function closeDrawer() {
    setOpen(false);
  }

  return (
    <>
      {/* MOBIL UST CUBUK — sadece md altinda gorunur; hamburger + marka */}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label={t("nav.openMenu")}
          aria-expanded={open}
          className="rounded-lg p-1.5 text-xl hover:bg-slate-800"
        >
          ☰
        </button>
        <div className="text-base font-bold">
          Plan<span className="text-blue-400">Rep</span>
        </div>
        <NotificationBell locale={locale} />
      </div>

      {/* ARKA PLAN (BACKDROP) — drawer acikken tiklaninca kapatir */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <aside
        ref={drawerRef}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? t("nav.menu") : undefined}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-slate-900 text-slate-200 transition-transform duration-200 ease-out md:static md:z-auto md:w-60 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="hidden px-5 py-5 md:block">
          <div className="text-xl font-bold text-white">
            Plan<span className="text-blue-400">Rep</span>
          </div>
          <div className="text-xs text-slate-400">{t("tagline")}</div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 md:hidden">
          <div className="text-xl font-bold text-white">
            Plan<span className="text-blue-400">Rep</span>
          </div>
          <button
            onClick={closeDrawer}
            aria-label={t("nav.closeMenu")}
            className="rounded-lg p-1 text-xl text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.filter((n) => !n.adminOnly || user.role === "admin").map((n) => {
            const active =
              n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={closeDrawer}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span>{n.icon}</span>
                {t(n.key)}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800 px-5 py-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="font-medium text-white">{user.name}</div>
              <div className="text-xs text-slate-400">{t(`role.${user.role}` as TKey)}</div>
            </div>
            <div className="hidden md:block">
              <NotificationBell locale={locale} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-1 text-xs">
              {(["tr", "en"] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => switchLocale(l)}
                  className={`rounded px-2 py-1 uppercase ${
                    locale === l
                      ? "bg-slate-700 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <button
              onClick={logout}
              className="text-xs text-slate-400 hover:text-white"
            >
              {t("logout")} ↪
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
