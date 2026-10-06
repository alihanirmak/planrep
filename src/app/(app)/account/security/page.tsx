"use client";

import { useEffect, useState } from "react";
import { getT, readLocaleClient, formatT } from "@/lib/i18n";

type Status = {
  enabled: boolean;
  pendingSetup: boolean;
  remainingBackupCodes: number;
  authProvider: "local" | "sso";
  ssoProvider: string | null;
};

export default function AccountSecurityPage() {
  const t = getT(readLocaleClient());
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpAuthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loadStatus() {
    fetch("/api/auth/totp/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus);
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function startSetup() {
    setMsg(null);
    const res = await fetch("/api/auth/totp/setup", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setSetup(body);
    } else {
      setMsg(body.error ?? "error");
    }
  }

  function cancelSetup() {
    setSetup(null);
    setCode("");
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/auth/totp/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setBackupCodes(body.backupCodes);
      setSetup(null);
      setCode("");
      loadStatus();
    } else {
      setMsg(body.error === "invalid_code" ? t("security.totpInvalidCode") : body.error);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/auth/totp/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: disablePassword }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setShowDisable(false);
      setDisablePassword("");
      setBackupCodes(null);
      loadStatus();
    } else {
      setMsg(body.error === "wrong_password" ? t("security.totpWrongPassword") : body.error);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("security.title")}</h1>

      {status?.authProvider === "sso" && (
        <div className="mt-6 max-w-xl rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
          {formatT(t("security.ssoActive"), { provider: status.ssoProvider ?? "SSO" })}
        </div>
      )}

      <div className="mt-6 max-w-xl rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t("security.totpSection")}
        </h2>

        {status == null ? (
          <p className="mt-3 text-sm text-slate-400">{t("common.loading")}</p>
        ) : backupCodes ? (
          <div className="mt-4">
            <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{t("security.totpDone")}</div>
            <p className="mt-3 text-sm text-slate-600">{t("security.totpBackupIntro")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-800">
              {backupCodes.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
            <button
              onClick={() => setBackupCodes(null)}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("common.save")}
            </button>
          </div>
        ) : status.enabled ? (
          <div className="mt-3">
            <p className="text-sm text-green-700">{t("security.totpEnabled")}</p>
            <p className="mt-1 text-xs text-slate-400">
              {formatT(t("security.totpBackupRemaining"), { count: status.remainingBackupCodes })}
            </p>
            {!showDisable ? (
              <button
                onClick={() => setShowDisable(true)}
                className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100"
              >
                {t("security.totpDisable")}
              </button>
            ) : (
              <form onSubmit={confirmDisable} className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-xs text-slate-500">
                  {t("security.totpDisablePasswordLabel")}
                  <input
                    type="password"
                    required
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    className="mt-1 w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {t("security.totpDisableConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDisable(false);
                    setDisablePassword("");
                    setMsg(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  {t("security.totpCancel")}
                </button>
              </form>
            )}
          </div>
        ) : setup ? (
          <form onSubmit={confirmEnable} className="mt-3">
            <p className="text-sm text-slate-600">{t("security.totpSetupIntro")}</p>
            <div className="mt-3 rounded-lg bg-slate-50 p-4">
              <div className="text-xs text-slate-400">{t("security.totpSecretLabel")}</div>
              <div className="mt-1 font-mono text-lg tracking-widest text-slate-800">{setup.secret}</div>
            </div>
            <label className="mt-4 flex flex-col text-xs text-slate-500">
              {t("security.totpCodeLabel")}
              <input
                type="text"
                inputMode="numeric"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-widest text-slate-900"
                placeholder="123456"
              />
            </label>
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t("security.totpConfirm")}
              </button>
              <button
                type="button"
                onClick={cancelSetup}
                className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
              >
                {t("security.totpCancel")}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-slate-500">{t("security.totpDisabled")}</p>
            <button
              onClick={startSetup}
              className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("security.totpEnable")}
            </button>
          </div>
        )}

        {msg && <div className="mt-3 text-sm text-red-600">{msg}</div>}
      </div>
    </div>
  );
}
