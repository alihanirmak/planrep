"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getT } from "@/lib/i18n";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = getT("tr");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(searchParams.get("next") ?? "/");
      router.refresh();
    } else {
      setError(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold text-slate-800">
            Plan<span className="text-blue-600">Rep</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">{t("tagline")}</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t("login.email")}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              placeholder="admin@planrep.local"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {t("login.password")}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {t("login.error")}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? t("common.loading") : t("login.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
