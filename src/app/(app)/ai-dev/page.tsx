"use client";

import { useRef, useState } from "react";
import { getT, readLocaleClient } from "@/lib/i18n";

type ActionResult = {
  index: number;
  type: string;
  status: "created" | "exists" | "skipped" | "error";
  message: string;
  entityId?: number;
  entityCode?: string;
};

type DevPlan = { summary?: string; actions: Array<{ type: string }> };

const STATUS_STYLE: Record<ActionResult["status"], string> = {
  created: "bg-emerald-100 text-emerald-700",
  exists: "bg-slate-100 text-slate-500",
  skipped: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
};

const EXAMPLES = [
  'MODEL SALES "Satış Modeli" DIMS=REGION,TIME',
  'BOYUT REGION "Bölge" TIP=standard UYELER=EMEA:EMEA;APAC:APAC',
  'OLCU SALES AMOUNT "Tutar"',
  'RAPOR SALES "Bölgesel Satış" SATIR=REGION SUTUN=TIME',
];

// Bu ornekler SADECE axet-code CLI mevcutken calisir (dogal dil -> JSON
// plan cevirisi gerektirir) — yukaridaki EXAMPLES'teki basit "MODEL/BOYUT/
// OLCU/RAPOR" komutlari axet olmadan da (yapilandirilmis metin fallback'i
// ile) calisir, bunlar calismaz.
const ADVANCED_EXAMPLES = [
  "SALES modelinde bölge bazında satış anomalilerini analiz et ve Bölgesel Satış raporuna yorum olarak ekle",
  "SALES modelinde ACTUAL versiyonundan 3 dönem ileriye tahmin yap, FORECAST versiyonuna yaz",
  'Bölgesel Satış raporuna FORECAST versiyonunu karşılaştırma olarak ekle',
];

export default function AiDevPage() {
  const t = getT(readLocaleClient());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [plan, setPlan] = useState<DevPlan | null>(null);
  const [preview, setPreview] = useState<ActionResult[] | null>(null);
  const [applyResults, setApplyResults] = useState<ActionResult[] | null>(null);
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelCodeHint, setModelCodeHint] = useState("");
  const [modelNameHint, setModelNameHint] = useState("");

  function resetResult() {
    setError(null);
    setNote(null);
    setPlan(null);
    setPreview(null);
    setApplyResults(null);
  }

  async function planFromMessage() {
    if (!message.trim()) return;
    resetResult();
    setBusy(true);
    const res = await fetch("/api/ai/dev/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.message ?? body.note ?? t("common.error"));
      setNote(body.note ?? null);
      return;
    }
    setPlan(body.plan);
    setPreview(body.results);
    setSource(body.source);
    setNote(body.note ?? null);
  }

  async function planFromExcel() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    resetResult();
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    if (modelCodeHint.trim()) fd.append("modelCode", modelCodeHint.trim().toUpperCase());
    if (modelNameHint.trim()) fd.append("modelName", modelNameHint.trim());
    const res = await fetch("/api/ai/dev/plan-from-excel", { method: "POST", body: fd });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.message ?? body.error ?? t("common.error"));
      return;
    }
    setPlan(body.plan);
    setPreview(body.results);
    setSource(body.source);
  }

  async function applyPlan() {
    if (!plan) return;
    if (!confirm("Plan uygulanacak — model/boyut/ölçü/rapor/veri oluşturulacak. Onaylıyor musunuz?")) return;
    setApplying(true);
    const res = await fetch("/api/ai/dev/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    setApplying(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.message ?? body.error ?? t("common.error"));
      return;
    }
    setApplyResults(body.results);
    setPlan(null);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800">🤖 {t("nav.aiDev")}</h1>
      <p className="mt-1 text-sm text-slate-500">
        AI ile konuşarak model, boyut, ölçü ve rapor oluşturun — veya bir Excel şablonu yükleyip yapı+veriyi
        birlikte çıkarın. Hiçbir şey DOĞRUDAN yazılmaz: önce bir plan önizlenir, siz onaylamadan hiçbir
        değişiklik uygulanmaz.
      </p>

      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">💬 Sohbet ile oluştur</h2>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder='Örn: "Satış modeli oluştur, Bölge ve Zaman boyutlarıyla, Tutar ölçüsüyle"'
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setMessage((m) => (m ? `${m}\n${ex}` : ex))}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:border-blue-300 hover:text-blue-600"
            >
              {ex}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          🧠 Gelişmiş (anomali analizi, tahmin, rapor karşılaştırma, yorum ekleme) — SADECE axet-code CLI
          mevcutken çalışır:
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {ADVANCED_EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setMessage(ex)}
              className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs text-violet-600 hover:border-violet-300"
            >
              {ex}
            </button>
          ))}
        </div>
        <button
          onClick={planFromMessage}
          disabled={busy || !message.trim()}
          className="mt-3 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Düşünüyor..." : "Plan Oluştur"}
        </button>
      </div>

      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">📄 Excel şablonundan oluştur</h2>
        <p className="mb-3 text-xs text-slate-400">
          İlk satır başlık olmalı. Sayısal kolonlar ölçü, metin/kod kolonları boyut olarak yorumlanır.
          Mevcut bir modele veri eklemek için model kodunu girin — eşleşen başlıklar mevcut boyut/ölçülerle
          eşlenir, eşleşmeyenler için yeni boyut/ölçü önerilir.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="text-sm" />
          <label className="flex flex-col text-xs text-slate-500">
            Model Kodu (opsiyonel, mevcutsa)
            <input
              value={modelCodeHint}
              onChange={(e) => setModelCodeHint(e.target.value)}
              placeholder="SALES"
              className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Yeni Model Adı (opsiyonel)
            <input
              value={modelNameHint}
              onChange={(e) => setModelNameHint(e.target.value)}
              placeholder="Satış Modeli"
              className="mt-1 w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <button
            onClick={planFromExcel}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "İşleniyor..." : "Şablonu Analiz Et"}
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 p-5 text-sm text-red-700 shadow-sm">{error}</div>}
      {note && !error && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-xs text-amber-700 shadow-sm">{note}</div>}

      {plan && preview && (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Plan Önizlemesi</h2>
            {source && (
              <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
                {source === "axet" ? "✨ axet" : source === "excel" ? "📄 excel" : "kural tabanlı"}
              </span>
            )}
          </div>
          {plan.summary && <p className="mt-1 text-xs text-slate-500">{plan.summary}</p>}
          <ul className="mt-3 space-y-1.5">
            {preview.map((r) => (
              <li key={r.index} className="flex items-center gap-2 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
                <span className="text-slate-700">{r.message}</span>
              </li>
            ))}
          </ul>
          {preview.some((r) => r.status === "error") ? (
            <p className="mt-3 text-xs text-red-500">
              Planda hatalı adımlar var — düzeltip tekrar deneyin, hiçbir şey uygulanmayacak.
            </p>
          ) : (
            <button
              onClick={applyPlan}
              disabled={applying}
              className="mt-4 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying ? "Uygulanıyor..." : "✅ Uygula"}
            </button>
          )}
        </div>
      )}

      {applyResults && (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Uygulama Sonucu</h2>
          <ul className="mt-3 space-y-1.5">
            {applyResults.map((r) => (
              <li key={r.index} className="flex items-center gap-2 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
                <span className="text-slate-700">{r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
