"use client";

import { useEffect, useMemo, useState } from "react";
import { getT, readLocaleClient } from "@/lib/i18n";

type Source = { id: string; name: string; description: string };
type ConnectorInfo = { id: string; name: string; status: string | null; sources: Source[] };
type Model = { id: number; code: string; name: string; dims: Array<{ code: string; name: string }> };
type Preview = { columns: string[]; rows: Array<Record<string, string | number>>; total: number };

export default function IntegrationsPage() {
  const t = getT(readLocaleClient());
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [connectorId, setConnectorId] = useState<string>("");
  const [sourceId, setSourceId] = useState<string>("");
  const [modelId, setModelId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);

  const connector = useMemo(() => connectors.find((c) => c.id === connectorId), [connectors, connectorId]);
  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((list: ConnectorInfo[]) => {
        setConnectors(list);
        const ready = list.find((c) => c.status == null);
        if (ready) setConnectorId(ready.id);
      });
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      });
  }, []);

  async function loadPreview(src: string) {
    setSourceId(src);
    setPreview(null);
    setResult(null);
    if (!src) return;
    const res = await fetch("/api/integrations/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connector: connectorId, source: src }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setResult({ ok: false, text: b.message ?? "Önizleme alınamadı" });
      return;
    }
    const p: Preview = await res.json();
    setPreview(p);
    // Otomatik esleme onerisi: kolon adi ile boyut kodu/adi benzerligi
    const auto: Record<string, string> = {};
    for (const col of p.columns) {
      const lc = col.toLocaleLowerCase("tr");
      if (["amount", "value", "deger", "tutar"].some((k) => lc.includes(k))) {
        auto[col] = "DEGER";
        continue;
      }
      const dim = model?.dims.find(
        (d) =>
          lc.includes(d.code.toLocaleLowerCase("tr")) ||
          d.code.toLocaleLowerCase("tr").includes(lc) ||
          lc.includes(d.name.toLocaleLowerCase("tr"))
      );
      if (dim) auto[col] = dim.code;
      else if (lc.includes("period") || lc.includes("fiscal") || lc.includes("date")) {
        const time = model?.dims.find((d) => d.code === "TIME");
        if (time) auto[col] = time.code;
      } else if (lc.includes("version")) {
        const v = model?.dims.find((d) => d.code === "VERSION");
        if (v) auto[col] = v.code;
      } else if (lc.includes("costcenter") || lc.includes("cost_center")) {
        const cc = model?.dims.find((d) => d.code === "COSTCENTER");
        if (cc) auto[col] = cc.code;
      } else if (lc.includes("account") || lc.includes("glaccount")) {
        const a = model?.dims.find((d) => d.code === "ACCOUNT");
        if (a) auto[col] = a.code;
      } else auto[col] = "";
    }
    setMapping(auto);
  }

  async function runImport() {
    if (!connectorId || !sourceId || modelId == null) return;
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/integrations/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connector: connectorId, source: sourceId, modelId, mapping }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setResult({ ok: true, text: `✅ ${body.inserted} satır içeri alındı (Yükleme #${body.uploadId})` });
    } else if (body.error === "validation") {
      setResult({ ok: false, text: "Doğrulama hataları — hiçbir satır alınmadı:", errors: body.errors });
    } else {
      setResult({ ok: false, text: body.message ?? "İçeri alma başarısız" });
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("nav.integrations")}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {t("pg.integrations.sub")} Gerçek SAP bağlantısı için <code>.env.local</code> içinde
        SAP_ODATA_URL / SAP_USER / SAP_PASS tanımla.
      </p>

      {/* Konnektor durumlari */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {connectors.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setConnectorId(c.id);
              setSourceId("");
              setPreview(null);
            }}
            className={`rounded-xl border-2 p-4 text-left ${
              connectorId === c.id ? "border-blue-500 bg-blue-50/50" : "border-transparent bg-white"
            } shadow-sm`}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🔌</span>
              <span className="font-semibold text-slate-800">{c.name}</span>
              {c.status == null ? (
                <span className="ml-auto rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">bağlı</span>
              ) : (
                <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700" title={c.status}>
                  yapılandırma gerekli
                </span>
              )}
            </div>
            {c.status && <div className="mt-1 text-xs text-slate-400">{c.status}</div>}
          </button>
        ))}
      </div>

      {connector && connector.status == null && (
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Kaynak
              <select value={sourceId} onChange={(e) => loadPreview(e.target.value)} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                <option value="">Seç...</option>
                {connector.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Hedef model
              <select value={modelId ?? ""} onChange={(e) => setModelId(Number(e.target.value))} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {preview && (
              <button onClick={runImport} disabled={busy} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? "Alınıyor..." : `⬇ İçeri Al (${preview.total} satır)`}
              </button>
            )}
          </div>

          {preview && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-slate-600">Kolon Eşleme</h3>
              <div className="mt-2 flex flex-wrap gap-3">
                {preview.columns.map((col) => (
                  <label key={col} className="flex flex-col text-xs text-slate-500">
                    <span className="font-mono">{col}</span>
                    <select
                      value={mapping[col] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                      className={`mt-1 rounded-lg border px-2 py-1.5 text-sm ${mapping[col] ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-500"}`}
                    >
                      <option value="">(yoksay)</option>
                      <option value="DEGER">→ DEĞER</option>
                      {model?.dims.map((d) => (
                        <option key={d.code} value={d.code}>
                          → {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <h3 className="mt-4 text-sm font-semibold text-slate-600">Önizleme (ilk 20 satır)</h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c} className="px-3 py-2 text-left font-mono">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        {preview.columns.map((c) => (
                          <td key={c} className="whitespace-nowrap px-3 py-1">
                            {String(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div className={`mt-4 rounded-lg px-4 py-3 text-sm ${result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
              <div>{result.text}</div>
              {result.errors && (
                <ul className="mt-2 max-h-48 list-inside list-disc overflow-y-auto text-xs">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
