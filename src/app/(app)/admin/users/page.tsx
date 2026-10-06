"use client";

import { useCallback, useEffect, useState } from "react";
import { getT, LOCALE_COOKIE, type Locale, type TKey } from "@/lib/i18n";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";

type UserRow = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "planner" | "viewer";
  createdAt: string;
};

type Dim = { id: number; code: string; name: string; members: Member[] };

function readLocale(): Locale {
  if (typeof document === "undefined") return "tr";
  return document.cookie.includes(`${LOCALE_COOKIE}=en`) ? "en" : "tr";
}

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "viewer" as UserRow["role"],
  });
  const t = getT(readLocale());

  const [dims, setDims] = useState<Dim[]>([]);
  const [accessUser, setAccessUser] = useState<UserRow | null>(null);
  const [accessMap, setAccessMap] = useState<Record<number, string[]>>({});
  const [accessMsg, setAccessMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setRows(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    fetch("/api/dimensions").then((r) => r.json()).then(setDims);
  }, [load]);

  async function openAccess(u: UserRow) {
    setAccessMsg(null);
    const res = await fetch(`/api/users/${u.id}/access`);
    const entries: Array<{ dimensionId: number; memberCodes: string[] }> = res.ok
      ? await res.json()
      : [];
    const map: Record<number, string[]> = {};
    for (const e of entries) map[e.dimensionId] = e.memberCodes;
    setAccessMap(map);
    setAccessUser(u);
  }

  async function saveAccess() {
    if (!accessUser) return;
    const entries = Object.entries(accessMap)
      .map(([dimId, codes]) => ({ dimensionId: Number(dimId), memberCodes: codes }))
      .filter((e) => e.memberCodes.length > 0);
    const res = await fetch(`/api/users/${accessUser.id}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    setAccessMsg(res.ok ? "✅ Veri yetkisi kaydedildi" : "Kaydetme başarısız");
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ name: "", email: "", password: "", role: "viewer" });
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error === "email_exists" ? "Bu e-posta zaten kayıtlı" : t("common.error"));
    }
  }

  async function changeRole(id: number, role: UserRow["role"]) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error === "last_admin" ? "Son yönetici düşürülemez" : t("common.error"));
    }
    load();
  }

  async function removeUser(id: number) {
    if (!confirm(t("users.confirmDelete"))) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "cannot_delete_self" ? "Kendi hesabını silemezsin" : t("common.error")
      );
    }
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("users.title")}</h1>

      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-600">{t("users.new")}</h2>
        <form onSubmit={createUser} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-slate-500">
            {t("users.name")}
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            {t("users.email")}
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            {t("users.password")}
            <input
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            {t("users.role")}
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRow["role"] })}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              <option value="admin">{t("role.admin")}</option>
              <option value="planner">{t("role.planner")}</option>
              <option value="viewer">{t("role.viewer")}</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t("users.create")}
          </button>
        </form>
        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">{t("common.loading")}</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">{t("users.name")}</th>
                <th className="px-5 py-3">{t("users.email")}</th>
                <th className="px-5 py-3">{t("users.role")}</th>
                <th className="px-5 py-3">{t("users.createdAt")}</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3 font-medium">{u.name}</td>
                  <td className="px-5 py-3">{u.email}</td>
                  <td className="px-5 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value as UserRow["role"])}
                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                    >
                      <option value="admin">{t("role.admin")}</option>
                      <option value="planner">{t("role.planner")}</option>
                      <option value="viewer">{t("role.viewer")}</option>
                    </select>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => openAccess(u)}
                      className="mr-3 text-xs text-blue-500 hover:text-blue-700"
                    >
                      🔐 Veri Yetkisi
                    </button>
                    <button
                      onClick={() => removeUser(u.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      {t("users.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {accessUser && (
        <div className="mt-6 rounded-xl border-2 border-blue-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-700">
              🔐 Veri Yetkisi — {accessUser.name}
            </h2>
            <span className="text-xs text-slate-400">
              Boş bırakılan boyut = tam erişim. Seçim yapılan boyutta kullanıcı yalnızca
              seçilen üyeleri (ve altlarını) görür/yazar.
            </span>
            <button
              onClick={() => setAccessUser(null)}
              className="ml-auto text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {dims.map((d) => (
              <MemberPicker
                key={d.id}
                label={d.name}
                members={d.members}
                selected={accessMap[d.id] ?? []}
                onChange={(codes) => setAccessMap({ ...accessMap, [d.id]: codes })}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveAccess}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Kaydet
            </button>
            {accessMsg && <span className="text-sm text-slate-500">{accessMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
