"use client";

import { useCallback, useEffect, useState } from "react";
import { getT, readLocaleClient } from "@/lib/i18n";

type ModelInfo = { id: number; code: string; name: string };
type UploadRow = {
  id: number;
  filename: string;
  rowCount: number;
  status: "done" | "reverted" | "failed";
  createdAt: string;
  userName: string | null;
  modelName: string | null;
};

export default function UploadPage() {
  const t = getT(readLocaleClient());
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const [history, setHistory] = useState<UploadRow[]>([]);
  const [fileKey, setFileKey] = useState(0);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: ModelInfo[]) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      });
  }, []);

  const loadHistory = useCallback(() => {
    fetch("/api/uploads")
      .then((r) => r.json())
      .then(setHistory);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || modelId == null) return;
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.append("modelId", String(modelId));
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setResult({ ok: true, text: `✅ ${body.inserted} satır yüklendi.` });
      setFile(null);
      setFileKey((k) => k + 1);
    } else if (body.error === "validation") {
      setResult({
        ok: false,
        text: "Dosyada hatalar var, hiçbir satır yüklenmedi:",
        errors: body.errors,
      });
    } else {
      setResult({ ok: false, text: "Yükleme başarısız: " + (body.error ?? "bilinmeyen hata") });
    }
    loadHistory();
  }

  async function revert(id: number) {
    if (!confirm("Bu yüklemenin verileri silinsin mi?")) return;
    await fetch(`/api/uploads/${id}/revert`, { method: "POST" });
    loadHistory();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("nav.upload")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("pg.upload.sub")}</p>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-4">
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
            Excel dosyası (.xlsx)
            <input
              key={fileKey}
              type="file"
              accept=".xlsx"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !file}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? t("common.loading") : t("pg.upload.button")}
          </button>
          {modelId != null && (
            <a
              href={`/api/upload/template?modelId=${modelId}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {t("pg.upload.template")}
            </a>
          )}
        </form>

        {result && (
          <div
            className={`mt-4 rounded-lg px-4 py-3 text-sm ${
              result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
            }`}
          >
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

      <h2 className="mt-8 text-lg font-semibold text-slate-800">{t("pg.upload.history")}</h2>
      <div className="mt-3 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Tarih</th>
              <th className="px-5 py-3">Model</th>
              <th className="px-5 py-3">Dosya</th>
              <th className="px-5 py-3">Kullanıcı</th>
              <th className="px-5 py-3">Satır</th>
              <th className="px-5 py-3">Durum</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {history.map((u) => (
              <tr key={u.id}>
                <td className="whitespace-nowrap px-5 py-2 text-xs text-slate-400">
                  {new Date(u.createdAt).toLocaleString()}
                </td>
                <td className="px-5 py-2">{u.modelName}</td>
                <td className="px-5 py-2">{u.filename}</td>
                <td className="px-5 py-2">{u.userName}</td>
                <td className="px-5 py-2">{u.rowCount}</td>
                <td className="px-5 py-2">
                  {u.status === "done" ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      yüklendi
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      geri alındı
                    </span>
                  )}
                </td>
                <td className="px-5 py-2 text-right">
                  {u.status === "done" && (
                    <button
                      onClick={() => revert(u.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Geri al
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-sm text-slate-400">
                  Henüz yükleme yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
