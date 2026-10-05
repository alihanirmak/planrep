import { cookies } from "next/headers";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { LOCALE_COOKIE, getT } from "@/lib/i18n";
import { sqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = (await getSession())!;
  const store = await cookies();
  const locale = store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "tr";
  const t = getT(locale);

  const count = (table: string) =>
    (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;

  const cards = [
    { label: t("home.models"), value: count("models"), href: "/modeling", icon: "🧊" },
    { label: t("home.reports"), value: count("reports"), href: "/reports", icon: "📊" },
    { label: t("home.dashboards"), value: count("dashboards"), href: "/dashboards", icon: "📈" },
    { label: t("home.users"), value: count("users"), href: "/admin/users", icon: "👥" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">
        {t("home.welcome")}, {session.name} 👋
      </h1>
      <p className="mt-1 text-sm text-slate-500">{t("home.subtitle")}</p>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-xl bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="text-2xl">{c.icon}</div>
            <div className="mt-2 text-3xl font-bold text-slate-800">{c.value}</div>
            <div className="text-sm text-slate-500">{c.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
