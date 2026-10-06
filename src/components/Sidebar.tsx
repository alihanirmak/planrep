"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getT, LOCALE_COOKIE, type Locale, type TKey } from "@/lib/i18n";
import type { SessionUser } from "@/lib/session";
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

  function switchLocale(next: Locale) {
    setLocaleCookie(next);
    router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-200">
      <div className="px-5 py-5">
        <div className="text-xl font-bold text-white">
          Plan<span className="text-blue-400">Rep</span>
        </div>
        <div className="text-xs text-slate-400">{t("tagline")}</div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.filter((n) => !n.adminOnly || user.role === "admin").map((n) => {
          const active =
            n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
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
          <NotificationBell locale={locale} />
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
  );
}
