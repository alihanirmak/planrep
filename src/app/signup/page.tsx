"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getT } from "@/lib/i18n";

export default function SignupPage() {
  const router = useRouter();
  const t = getT("tr");
  const [form, setForm] = useState({
    tenantCode: "",
    tenantName: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(
      body.error === "tenant_code_exists"
        ? t("signup.tenantCodeExists")
        : body.error === "email_exists"
          ? t("signup.emailExists")
          : t("common.error")
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold text-slate-800">
            Plan<span className="text-blue-600">Rep</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">{t("signup.subtitle")}</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t("signup.tenantName")}
            </label>
            <input
              required
              value={form.tenantName}
              onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t("signup.tenantCode")}
            </label>
            <input
              required
              pattern="[a-z0-9-]+"
              title={t("signup.tenantCodeHint")}
              value={form.tenantCode}
              onChange={(e) => setForm({ ...form, tenantCode: e.target.value.toLowerCase() })}
              placeholder="acme-corp"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">{t("signup.tenantCodeHint")}</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t("signup.adminName")}
            </label>
            <input
              required
              value={form.adminName}
              onChange={(e) => setForm({ ...form, adminName: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t("login.email")}
            </label>
            <input
              type="email"
              required
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t("login.password")}
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={form.adminPassword}
              onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? t("common.loading") : t("signup.submit")}
          </button>
          <a href="/login" className="block w-full text-center text-xs text-slate-400 hover:text-slate-600">
            {t("signup.loginLink")}
          </a>
        </form>
      </div>
    </div>
  );
}
