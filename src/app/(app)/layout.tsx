import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const store = await cookies();
  const locale: Locale =
    store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "tr";

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar user={session} locale={locale} />
      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
