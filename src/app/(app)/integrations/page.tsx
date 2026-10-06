"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getT, readLocaleClient } from "@/lib/i18n";

type Source = { id: string; name: string; description: string };
type ConnectorInfo = {
  id: number;
  name: string;
  typeLabel: string;
  status: string | null;
  sources: Source[];
};
type Model = { id: number; code: string; name: string; dims: Array<{ code: string; name: string }> };
type Preview = { columns: string[]; rows: Array<Record<string, string | number>>; total: number };

type ConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "textarea";
  required?: boolean;
  placeholder?: string;
  helpText?: string;
};
type ConnectorTypeDefInfo = {
  type: string;
  label: string;
  description: string;
  configFields: ConfigField[];
};
type ConnectorConfig = {
  id: number;
  type: string;
  name: string;
  config: Record<string, string>;
  active: boolean;
};

export default function IntegrationsPage() {
  const t = getT(readLocaleClient());
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [connectorId, setConnectorId] = useState<number | null>(null);
  const [sourceId, setSourceId] = useState<string>("");
  const [modelId, setModelId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const [role, setRole] = useState("viewer");

  // Baglanti yonetimi (admin)
  const [configs, setConfigs] = useState<ConnectorConfig[]>([]);
  const [types, setTypes] = useState<ConnectorTypeDefInfo[]>([]);
  const [showManage, setShowManage] = useState(false);
  const [newType, setNewType] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newFields, setNewFields] = useState<Record<string, string>>({});
  const [manageMsg, setManageMsg] = useState<string | null>(null);

  const connector = connectors.find((c) => c.id === connectorId);
  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);
  const newTypeDef = useMemo(() => types.find((ty) => ty.type === newType), [types, newType]);

  const loadConnectors = useCallback(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((list: ConnectorInfo[]) => {
        setConnectors(list);
        setConnectorId(list.find((c) => c.status == null)?.id ?? list[0]?.id ?? null);
      });
  }, []);

  const loadConfigs = useCallback(() => {
    fetch("/api/connector-configs")
      .then((r) => (r.ok ? r.json() : []))
      .then(setConfigs);
  }, []);

  useEffect(() => {
    loadConnectors();
    loadConfigs();
    fetch("/api/connector-configs/types")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ConnectorTypeDefInfo[]) => {
        setTypes(list);
        if (list.length > 0) setNewType(list[0].type);
      });
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      });
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
  }, [loadConnectors, loadConfigs]);

  async function loadPreview(src: string) {
    setSourceId(src);
    setPreview(null);
    setResult(null);
    if (!src || connectorId == null) return;
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
    if (connectorId == null || !sourceId || modelId == null) return;
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
    } else if (body.error === "workflow_locked") {
      setResult({ ok: false, text: `🔒 ${body.message ?? "Veri kilitli"}` });
    } else if (body.error === "business_rule_violated") {
      setResult({ ok: false, text: `⛔ ${body.message ?? "İş kuralı ihlali"}` });
    } else {
      setResult({ ok: false, text: body.message ?? "İçeri alma başarısız" });
    }
  }

  async function createConfig() {
    if (!newType || !newName.trim()) return;
    setManageMsg(null);
    const res = await fetch("/api/connector-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: newType, name: newName, config: newFields }),
    });
    if (res.ok) {
      setNewName("");
      setNewFields({});
      loadConfigs();
      loadConnectors();
    } else {
      const body = await res.json().catch(() => ({}));
      setManageMsg(
        body.error === "missing_fields"
          ? `Eksik alanlar: ${body.fields.join(", ")}`
          : body.detail ?? body.error ?? "Bağlantı oluşturulamadı"
      );
    }
  }

  async function toggleConfig(cfg: ConnectorConfig) {
    await fetch(`/api/connector-configs/${cfg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !cfg.active }),
    });
    loadConfigs();
    loadConnectors();
  }

  async function removeConfig(cfg: ConnectorConfig) {
    if (!confirm(`"${cfg.name}" bağlantısı silinsin mi?`)) return;
    await fetch(`/api/connector-configs/${cfg.id}`, { method: "DELETE" });
    loadConfigs();
    loadConnectors();
  }

  async function testConfig(cfg: ConnectorConfig) {
    setManageMsg(null);
    const res = await fetch(`/api/connector-configs/${cfg.id}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setManageMsg(body.ok ? `✅ "${cfg.name}" bağlantısı başarılı` : `❌ ${body.message ?? "Bağlantı başarısız"}`);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("nav.integrations")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("pg.integrations.sub")}</p>
        </div>
        {role === "admin" && (
          <button
            onClick={() => setShowManage(!showManage)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            🔌 Bağlantıları Yönet
          </button>
        )}
      </div>

      {showManage && (
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Mevcut Bağlantılar</h2>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Ad</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-left">Durum</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {configs.map((cfg) => (
                  <tr key={cfg.id} className={cfg.active ? "" : "opacity-40"}>
                    <td className="px-3 py-2 font-medium">{cfg.name}</td>
                    <td className="px-3 py-2 text-xs">{cfg.type}</td>
                    <td className="px-3 py-2 text-xs">{cfg.active ? "Aktif" : "Pasif"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2 text-xs">
                        <button onClick={() => testConfig(cfg)} className="text-blue-500 hover:underline">
                          Test Et
                        </button>
                        <button onClick={() => toggleConfig(cfg)} className="text-blue-500 hover:underline">
                          {cfg.active ? "Pasifleştir" : "Aktifleştir"}
                        </button>
                        <button onClick={() => removeConfig(cfg)} className="text-red-500 hover:underline">
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {configs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-400">
                      Henüz bağlantı yok
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-400">+ Yeni Bağlantı</h2>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Tür
              <select
                value={newType}
                onChange={(e) => {
                  setNewType(e.target.value);
                  setNewFields({});
                }}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                {types.map((ty) => (
                  <option key={ty.type} value={ty.type}>
                    {ty.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Bağlantı Adı
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="örn. Prod SAP"
                className="mt-1 w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            {newTypeDef?.configFields.map((f) =>
              f.type === "textarea" ? (
                <label key={f.key} className="flex flex-col text-xs text-slate-500">
                  {f.label}
                  <textarea
                    value={newFields[f.key] ?? ""}
                    onChange={(e) => setNewFields({ ...newFields, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    rows={1}
                    className="mt-1 w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
              ) : (
                <label key={f.key} className="flex flex-col text-xs text-slate-500">
                  {f.label}
                  <input
                    type={f.type === "password" ? "password" : "text"}
                    value={newFields[f.key] ?? ""}
                    onChange={(e) => setNewFields({ ...newFields, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="mt-1 w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
              )
            )}
            <button
              onClick={createConfig}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Oluştur
            </button>
          </div>
          {newTypeDef?.description && <p className="mt-2 text-[10px] text-slate-400">{newTypeDef.description}</p>}
          {manageMsg && <div className="mt-2 text-sm text-slate-600">{manageMsg}</div>}
        </div>
      )}

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
              <span className="text-xs text-slate-400">{c.typeLabel}</span>
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
        {connectors.length === 0 && (
          <div className="rounded-xl bg-white p-4 text-sm text-slate-400 shadow-sm md:col-span-2">
            Henüz bağlantı yapılandırılmadı.
            {role === "admin" && " Yukarıdaki \"Bağlantıları Yönet\" ile yeni bir bağlantı ekleyebilirsiniz."}
          </div>
        )}
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
