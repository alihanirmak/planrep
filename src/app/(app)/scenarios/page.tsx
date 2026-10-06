"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";
import type { QueryResult } from "@/lib/report-types";
import { getT, readLocaleClient } from "@/lib/i18n";

type Dim = { id: number; code: string; name: string; type: string; members: Member[] };
type Model = { id: number; code: string; name: string; dims: Dim[] };

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

export default function ScenariosPage() {
  const t = getT(readLocaleClient());
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [rowDim, setRowDim] = useState<string>("");
  const [fromVersion, setFromVersion] = useState<string>("");
  const [toVersion, setToVersion] = useState<string>("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [role, setRole] = useState("viewer");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);
  const versionDim = useMemo(() => model?.dims.find((d) => d.type === "version") ?? null, [model]);
  const otherDims = useMemo(
    () => model?.dims.filter((d) => d.code !== versionDim?.code && d.code !== rowDim) ?? [],
    [model, versionDim, rowDim]
  );

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      });
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
  }, []);

  useEffect(() => {
    if (!model) return;
    Promise.resolve().then(() => {
      const vd = model.dims.find((d) => d.type === "version");
      const firstNonVersion = model.dims.find((d) => d.code !== vd?.code);
      setRowDim(firstNonVersion?.code ?? "");
      if (vd && vd.members.length >= 2) {
        setFromVersion(vd.members[0].code);
        setToVersion(vd.members[1].code);
      } else {
        setFromVersion("");
        setToVersion("");
      }
      setFilters({});
      setResult(null);
    });
  }, [model]);

  const compare = useCallback(() => {
    if (!modelId || !rowDim || !versionDim) return;
    Promise.resolve()
      .then(() => setMsg(null))
      .then(() =>
        fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId, rowDim, colDim: versionDim.code, filters }),
        })
      )
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setMsg(d.message ?? d.error);
          setResult(null);
        } else {
          setResult(d);
        }
      });
  }, [modelId, rowDim, versionDim, filters]);

  useEffect(() => {
    compare();
  }, [compare]);

  async function copyScenario() {
    if (!modelId || !versionDim || !fromVersion || !toVersion) return;
    if (!confirm(`"${fromVersion}" verisi "${toVersion}" üzerine kopyalansın mı? Mevcut değerler ezilir.`)) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/scenario/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, fromVersion, toVersion, filters }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(`✅ ${body.copied} kayıt kopyalandı`);
      compare();
    } else if (res.status === 423) {
      setMsg(`🔒 ${body.message ?? "Veri kilitli"}`);
    } else {
      setMsg(body.message ?? body.error ?? "Kopyalama başarısız");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("nav.scenarios")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("pg.scenarios.sub")}</p>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm">
        <label className="flex flex-col text-xs text-slate-500">
          Model
          <select
            value={modelId ?? ""}
            onChange={(e) => setModelId(Number(e.target.value))}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          {t("pg.scenarios.rowDim")}
          <select
            value={rowDim}
            onChange={(e) => setRowDim(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          >
            {model?.dims
              .filter((d) => d.code !== versionDim?.code)
              .map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        {versionDim && (
          <>
            <label className="flex flex-col text-xs text-slate-500">
              {t("pg.scenarios.from")}
              <select
                value={fromVersion}
                onChange={(e) => setFromVersion(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                {versionDim.members.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              {t("pg.scenarios.to")}
              <select
                value={toVersion}
                onChange={(e) => setToVersion(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                {versionDim.members.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {otherDims.map((d) => (
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
            onClick={copyScenario}
            disabled={busy || !fromVersion || !toVersion || fromVersion === toVersion}
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {t("pg.scenarios.copy")}: {fromVersion} → {toVersion}
          </button>
        )}
      </div>

      {msg && <div className="mt-2 text-sm text-slate-600">{msg}</div>}

      {result && (
        <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">{model?.dims.find((d) => d.code === rowDim)?.name}</th>
                <th className="px-4 py-2.5 text-right">{fromVersion}</th>
                <th className="px-4 py-2.5 text-right">{toVersion}</th>
                <th className="px-4 py-2.5 text-right">{t("pg.scenarios.variance")}</th>
                <th className="px-4 py-2.5 text-right">{t("pg.scenarios.variancePct")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {result.rows.map((r) => {
                const from = r.cells[fromVersion] ?? 0;
                const to = r.cells[toVersion] ?? 0;
                const variance = to - from;
                const pct = from !== 0 ? (variance / Math.abs(from)) * 100 : null;
                return (
                  <tr key={r.code}>
                    <td className="px-4 py-1.5" style={{ paddingLeft: 16 + r.depth * 16 }}>
                      {r.name}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{nf.format(from)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{nf.format(to)}</td>
                    <td
                      className={`px-4 py-1.5 text-right tabular-nums ${
                        variance < 0 ? "text-red-600" : variance > 0 ? "text-green-600" : ""
                      }`}
                    >
                      {nf.format(variance)}
                    </td>
                    <td className="px-4 py-1.5 text-right text-xs tabular-nums text-slate-500">
                      {pct != null ? `${nf.format(pct)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
              {result.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                    Veri bulunamadı
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
