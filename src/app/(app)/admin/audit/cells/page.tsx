"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";

type Dim = { id: number; code: string; name: string; members: Member[] };
type Model = { id: number; code: string; name: string; dims: Dim[] };

type FactAuditEntry = {
  id: number;
  modelId: number;
  uploadId: number | null;
  coords: string[];
  oldValue: number | null;
  newValue: number | null;
  source: "write" | "revert" | "rollback";
  userId: number | null;
  createdAt: string;
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

const SOURCE_LABEL: Record<FactAuditEntry["source"], string> = {
  write: "Yazma",
  revert: "Geri Alma",
  rollback: "Hücre Geri Alma",
};

export default function CellAuditPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [entries, setEntries] = useState<FactAuditEntry[]>([]);
  const [role, setRole] = useState("viewer");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      });
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
  }, []);

  const load = useCallback(() => {
    if (!modelId) return;
    const coordsByDimCode: Record<string, string> = {};
    for (const [dim, codes] of Object.entries(filters)) {
      if (codes.length === 1) coordsByDimCode[dim] = codes[0];
    }
    const params = new URLSearchParams({ modelId: String(modelId) });
    if (Object.keys(coordsByDimCode).length > 0) {
      params.set("coords", JSON.stringify(coordsByDimCode));
    }
    fetch(`/api/fact-audit?${params.toString()}`)
      .then((r) => r.json())
      .then(setEntries);
  }, [modelId, filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function rollback(entry: FactAuditEntry) {
    if (
      !confirm(
        `Bu değişiklik geri alınsın mı? Yeni değer: ${entry.newValue ?? "—"} → Eski değer: ${entry.oldValue ?? "(silinecek)"}`
      )
    )
      return;
    setBusy(entry.id);
    setMsg(null);
    const res = await fetch(`/api/fact-audit/${entry.id}/rollback`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setMsg("✅ Geri alındı");
      load();
    } else if (res.status === 423) {
      setMsg(`🔒 ${body.message ?? "Veri kilitli"}`);
    } else {
      setMsg(body.message ?? body.error ?? "Geri alma başarısız");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Link href="/admin/audit" className="hover:text-blue-600">
          Denetim Kaydı
        </Link>
        <span>›</span>
        <span className="text-slate-600">Hücre Bazlı Denetim</span>
      </div>
      <h1 className="mt-2 text-2xl font-bold text-slate-800">🔍 Hücre Bazlı Denetim</h1>
      <p className="mt-1 text-sm text-slate-500">
        Her bir veri hücresinin eski/yeni değer geçmişini görüntüle; gerekirse tek bir değişikliği geri al.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-white p-4 shadow-sm">
        <label className="flex flex-col text-xs text-slate-500">
          Model
          <select
            value={modelId ?? ""}
            onChange={(e) => {
              setModelId(Number(e.target.value));
              setFilters({});
            }}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {model?.dims.map((d) => (
          <MemberPicker
            key={d.code}
            label={d.name}
            members={d.members}
            selected={filters[d.code] ?? []}
            onChange={(codes) => setFilters({ ...filters, [d.code]: codes })}
          />
        ))}
      </div>

      {msg && <div className="mt-2 text-sm text-slate-600">{msg}</div>}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left">Zaman</th>
              <th className="px-4 py-2.5 text-left">Koordinat</th>
              <th className="px-4 py-2.5 text-right">Eski Değer</th>
              <th className="px-4 py-2.5 text-right">Yeni Değer</th>
              <th className="px-4 py-2.5 text-left">Kaynak</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">
                  {new Date(e.createdAt).toLocaleString("tr-TR")}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{e.coords.join(" / ")}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                  {e.oldValue != null ? nf.format(e.oldValue) : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">
                  {e.newValue != null ? nf.format(e.newValue) : "— (silindi)"}
                </td>
                <td className="px-4 py-2 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5">{SOURCE_LABEL[e.source]}</span>
                </td>
                <td className="px-4 py-2 text-right">
                  {role !== "viewer" && (
                    <button
                      onClick={() => rollback(e)}
                      disabled={busy === e.id}
                      className="rounded-lg border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                    >
                      ↩ Geri Al
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  Kayıt bulunamadı
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
