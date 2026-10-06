"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getT } from "@/lib/i18n";

type SsoStatus = { enabled: boolean; providerLabel?: string };

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [error, setError] = useState<string | null>(() =>
    searchParams.get("sso_error") ? getT("tr")("login.ssoError") : null
  );
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<SsoStatus | null>(null);
  const t = getT("tr");

  useEffect(() => {
    fetch("/api/auth/sso/status")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then(setSso)
      .catch(() => setSso({ enabled: false }));
  }, []);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(t("login.error"));
      return;
    }
    if (body.requiresTotp) {
      setStep("totp");
      return;
    }
    router.push(searchParams.get("next") ?? "/");
    router.refresh();
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: totpCode }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(searchParams.get("next") ?? "/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "pending_login_expired"
          ? t("login.totpExpired")
          : t("login.totpError")
      );
      if (body.error === "pending_login_expired") setStep("credentials");
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
        {step === "credentials" ? (
          <form onSubmit={submitCredentials} className="space-y-4">
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
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? t("common.loading") : t("login.submit")}
            </button>
            {sso?.enabled && (
              <>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  {t("login.orDivider")}
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <a
                  href="/api/auth/sso/login"
                  className="flex w-full items-center justify-center rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {`${t("login.ssoButton")} ${sso.providerLabel ?? ""}`.trim()}
                </a>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={submitTotp} className="space-y-4">
            <p className="text-sm text-slate-600">{t("login.totpPrompt")}</p>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {t("login.totpCode")}
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-widest text-slate-900 focus:border-blue-500 focus:outline-none"
                placeholder="123456"
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
              {busy ? t("common.loading") : t("login.totpVerify")}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("credentials");
                setTotpCode("");
                setError(null);
              }}
              className="w-full text-xs text-slate-400 hover:text-slate-600"
            >
              {t("login.totpBack")}
            </button>
          </form>
        )}
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
