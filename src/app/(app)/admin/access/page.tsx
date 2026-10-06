"use client";

import { useEffect, useMemo, useState } from "react";
import { getT, LOCALE_COOKIE, formatT, type Locale } from "@/lib/i18n";
import DataAccessEditor from "@/components/DataAccessEditor";
import type { Member } from "@/lib/pivot";

type UserRow = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "planner" | "viewer";
  createdAt: string;
};

type Dim = { id: number; code: string; name: string; members: Member[] };

type TenantAccessEntry = { userId: number; dimensionId: number; memberCodes: string[] };

function readLocale(): Locale {
  if (typeof document === "undefined") return "tr";
  return document.cookie.includes(`${LOCALE_COOKIE}=en`) ? "en" : "tr";
}

export default function AccessOverviewPage() {
  const t = getT(readLocale());

  const [users, setUsers] = useState<UserRow[]>([]);
  const [dims, setDims] = useState<Dim[]>([]);
  // matrix[userId][dimensionId] = secili uye kodlari; kayit yoksa tam erisim
  const [matrix, setMatrix] = useState<Record<number, Record<number, string[]>>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyRestricted, setOnlyRestricted] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/users").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/dimensions").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/access").then((r) => (r.ok ? r.json() : [])),
    ]).then(([u, d, entries]: [UserRow[], Dim[], TenantAccessEntry[]]) => {
      setUsers(u);
      setDims(d);
      const m: Record<number, Record<number, string[]>> = {};
      for (const e of entries) {
        if (!m[e.userId]) m[e.userId] = {};
        m[e.userId][e.dimensionId] = e.memberCodes;
      }
      setMatrix(m);
      setLoading(false);
    });
  }, []);

  function isRestricted(userId: number): boolean {
    const row = matrix[userId];
    return !!row && Object.values(row).some((codes) => codes.length > 0);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return users.filter((u) => {
      if (onlyRestricted && !isRestricted(u.id)) return false;
      if (!q) return true;
      return (
        u.name.toLocaleLowerCase("tr").includes(q) || u.email.toLocaleLowerCase("tr").includes(q)
      );
    });
    // matrix degisimlerinde de yeniden filtrelenmeli (isRestricted kapaniyor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, search, onlyRestricted, matrix]);

  function openEditor(u: UserRow) {
    setEditingUser(u);
  }

  function handleSaved(userId: number, map: Record<number, string[]>) {
    setMatrix((prev) => ({ ...prev, [userId]: map }));
    setEditingUser(null);
  }

  const editorInitialMap = editingUser ? matrix[editingUser.id] ?? {} : {};

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("access.title")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("access.subtitle")}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("access.searchPlaceholder")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 sm:w-72"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyRestricted}
            onChange={(e) => setOnlyRestricted(e.target.checked)}
          />
          {t("access.onlyRestricted")}
        </label>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">{t("access.empty")}</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">{t("access.user")}</th>
                {dims.map((d) => (
                  <th key={d.id} className="px-5 py-3">
                    {d.name}
                  </th>
                ))}
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  {dims.map((d) => {
                    const codes = matrix[u.id]?.[d.id] ?? [];
                    const restricted = codes.length > 0;
                    return (
                      <td key={d.id} className="px-5 py-3">
                        <button
                          onClick={() => openEditor(u)}
                          className={
                            restricted
                              ? "rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200"
                              : "rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500 hover:bg-slate-200"
                          }
                        >
                          {restricted
                            ? formatT(t("access.restrictedCount"), { count: codes.length })
                            : t("access.fullAccess")}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => openEditor(u)}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >
                      {t("access.editButton")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingUser && (
        <DataAccessEditor
          userId={editingUser.id}
          userName={editingUser.name}
          dims={dims}
          initialMap={editorInitialMap}
          t={t}
          onClose={() => setEditingUser(null)}
          onSaved={(map) => handleSaved(editingUser.id, map)}
        />
      )}
    </div>
  );
}
