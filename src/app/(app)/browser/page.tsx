"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";
import { getT, readLocaleClient } from "@/lib/i18n";

type Dim = { id: number; code: string; name: string; members: Member[] };
type Model = { id: number; code: string; name: string; dims: Dim[] };
type FactRow = Record<string, string | number | null> & {
  id: number;
  value: number;
  uploadId: number | null;
  updatedAt: string;
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const PAGE_SIZE = 50;

export default function BrowserPage() {
  const t = getT(readLocaleClient());
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<FactRow[]>([]);
  const [names, setNames] = useState<Record<string, Record<string, string>>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [role, setRole] = useState<string>("viewer");
  const [msg, setMsg] = useState<string | null>(null);

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      });
    fetch("/api/me")
      .then((r) => r.json())
      .then((me) => setRole(me.role ?? "viewer"));
  }, []);

  const load = useCallback(
    (p: number) => {
      if (modelId == null) return;
      fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, filters, page: p, pageSize: PAGE_SIZE }),
      })
        .then((r) => r.json())
        .then((d) => {
          setRows(d.rows ?? []);
          setNames(d.names ?? {});
          setTotal(d.total ?? 0);
          setPage(p);
        });
    },
    [modelId, filters]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  async function deleteSlice() {
    if (modelId == null) return;
    const hasFilter = Object.values(filters).some((v) => v.length > 0);
    if (!hasFilter) {
      setMsg("Silmek için en az bir filtre seçmelisin (tüm modeli silmek engellenmiştir)");
      return;
    }
    if (!confirm(`Filtreye uyan ${total} kayıt kalıcı olarak silinsin mi?`)) return;
    const res = await fetch("/api/facts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, filters }),
    });
    const body = await res.json().catch(() => ({}));
    setMsg(res.ok ? `🗑 ${body.deleted} kayıt silindi` : "Silme başarısız");
    load(0);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("nav.browser")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("pg.browser.sub")}</p>

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
        {role !== "viewer" && (
          <button
            onClick={deleteSlice}
            className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            {t("pg.browser.deleteSlice")}
          </button>
        )}
      </div>
      {msg && <div className="mt-2 text-sm text-slate-500">{msg}</div>}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {model?.dims.map((d) => (
                <th key={d.code} className="px-4 py-2.5 text-left">
                  {d.name}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right">Değer</th>
              <th className="px-4 py-2.5 text-right">Yükleme</th>
              <th className="px-4 py-2.5 text-right">Güncellenme</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {rows.map((r) => (
              <tr key={r.id}>
                {model?.dims.map((d) => (
                  <td key={d.code} className="whitespace-nowrap px-4 py-1.5">
                    {names[d.code]?.[String(r[d.code])] ?? String(r[d.code])}
                    <span className="ml-1.5 font-mono text-[10px] text-slate-300">
                      {String(r[d.code])}
                    </span>
                  </td>
                ))}
                <td className={`px-4 py-1.5 text-right tabular-nums ${r.value < 0 ? "text-red-600" : ""}`}>
                  {nf.format(r.value)}
                </td>
                <td className="px-4 py-1.5 text-right text-xs text-slate-400">
                  {r.uploadId != null ? `#${r.uploadId}` : "—"}
                </td>
                <td className="px-4 py-1.5 text-right text-xs text-slate-400">
                  {new Date(r.updatedAt).toLocaleString("tr-TR")}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={(model?.dims.length ?? 0) + 3} className="px-4 py-8 text-center text-sm text-slate-400">
                  Kayıt bulunamadı
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center text-sm text-slate-500">
        Toplam {nf.format(total)} kayıt
        <div className="ml-auto flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => load(page - 1)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            ← Önceki
          </button>
          <span className="py-1.5">
            {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => load(page + 1)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Sonraki →
          </button>
        </div>
      </div>
    </div>
  );
}
