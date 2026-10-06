"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportDefV2 } from "@/lib/report-types";
import { getT, readLocaleClient } from "@/lib/i18n";

type Model = {
  id: number;
  code: string;
  name: string;
  dims: Array<{ code: string; name: string; members: Array<{ code: string; name: string }> }>;
};

const EXAMPLES = [
  "2025 bütçesinde masraf yeri bazında personel giderlerini göster",
  "Hesap bazında gerçekleşen ve bütçeyi karşılaştır",
  "En yüksek 3 masraf yerini aylara göre listele",
  "BT masraf yerinin 2025 gerçekleşen giderleri",
];

export default function AiPage() {
  const t = getT(readLocaleClient());
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ def: ReportDefV2; source: string; note: string | null } | null>(null);
  const [models, setModels] = useState<Model[]>([]);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then(setModels);
  }, []);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;
    if (q) setQuestion(q);
    setBusy(true);
    setError(null);
    setAnswer(null);
    const res = await fetch("/api/ai/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.note ?? t("err.aiUnresolved"));
      return;
    }
    setAnswer(await res.json());
  }

  function openInReports() {
    if (!answer) return;
    sessionStorage.setItem("planrep_ai_def", JSON.stringify(answer.def));
    router.push("/reports");
  }

  function describe(def: ReportDefV2): Array<[string, string]> {
    const model = models.find((m) => m.id === def.modelId);
    const dimName = (c: string) => model?.dims.find((d) => d.code === c)?.name ?? c;
    const memberName = (dim: string, c: string) =>
      model?.dims.find((d) => d.code === dim)?.members.find((m) => m.code === c)?.name ?? c;
    const out: Array<[string, string]> = [
      ["Model", model?.name ?? String(def.modelId)],
      ["Satırlar", def.rows.map(dimName).join(" → ")],
      ["Sütunlar", def.cols.map(dimName).join(" → ")],
    ];
    const f = Object.entries(def.filters)
      .map(([d, codes]) => `${dimName(d)}: ${codes.map((c) => memberName(d, c)).join(", ")}`)
      .join(" · ");
    if (f) out.push(["Filtreler", f]);
    if (def.options.topN) out.push(["Top-N", String(def.options.topN)]);
    return out;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800">✨ {t("nav.ai")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("pg.ai.sub")}</p>

      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Örn: 2025 bütçesinde masraf yeri bazında personel giderleri..."
            className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => ask()}
            disabled={busy || !question.trim()}
            className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? t("pg.ai.thinking") : t("pg.ai.ask")}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => ask(ex)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:border-blue-300 hover:text-blue-600"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {busy && (
        <div className="mt-4 rounded-xl bg-white p-5 text-sm text-slate-500 shadow-sm">
          ⏳ axet soruyu çözümlüyor — bu 10-60 saniye sürebilir...
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 p-5 text-sm text-red-700 shadow-sm">{error}</div>
      )}

      {answer && (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Çözümlenen rapor</h2>
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                answer.source === "axet" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {answer.source === "axet" ? "✨ axet" : "kural motoru"}
            </span>
          </div>
          {answer.note && <div className="mt-1 text-xs text-amber-600">{answer.note}</div>}
          <table className="mt-3 text-sm">
            <tbody>
              {describe(answer.def).map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4 text-xs font-semibold uppercase text-slate-400">{k}</td>
                  <td className="py-1 text-slate-700">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={openInReports}
            className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t("pg.ai.open")}
          </button>
        </div>
      )}
    </div>
  );
}
