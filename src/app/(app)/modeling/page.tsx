"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getT, readLocaleClient } from "@/lib/i18n";

type DimRow = {
  id: number;
  code: string;
  name: string;
  type: string;
  description: string | null;
  visibility: "public" | "private";
  ownerModelName: string | null;
  members: Array<{ id: number }>;
  usedIn: Array<{ id: number; name: string }>;
};
type Model = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  dims: Array<{ id: number; code: string; name: string }>;
};

const TYPE_LABEL: Record<string, string> = {
  standard: "Standart",
  time: "Zaman",
  version: "Versiyon",
};

export default function ModelingPage() {
  const t = getT(readLocaleClient());
  const router = useRouter();
  const [dims, setDims] = useState<DimRow[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [role, setRole] = useState("viewer");
  const [msg, setMsg] = useState<string | null>(null);
  const [showNewDim, setShowNewDim] = useState(false);
  const [showNewModel, setShowNewModel] = useState(false);
  const [dimDraft, setDimDraft] = useState({
    code: "",
    name: "",
    type: "standard",
    visibility: "public" as "public" | "private",
  });
  const [modelDraft, setModelDraft] = useState<{
    code: string;
    name: string;
    description: string;
    dimIds: number[];
  }>({ code: "", name: "", description: "", dimIds: [] });

  const canEdit = role !== "viewer";

  const load = useCallback(() => {
    fetch("/api/dimensions").then((r) => r.json()).then(setDims);
    fetch("/api/models").then((r) => r.json()).then(setModels);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
  }, [load]);

  async function createDim() {
    if (!dimDraft.code.trim() || !dimDraft.name.trim()) return;
    const res = await fetch("/api/dimensions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dimDraft),
    });
    if (res.ok) {
      const body = await res.json();
      setShowNewDim(false);
      setDimDraft({ code: "", name: "", type: "standard", visibility: "public" });
      router.push(`/modeling/dimensions/${body.id}`);
    } else {
      const b = await res.json().catch(() => ({}));
      setMsg(`⚠ ${b.detail ?? b.error ?? "Oluşturulamadı"}`);
    }
  }

  async function createModel() {
    if (!modelDraft.code.trim() || !modelDraft.name.trim() || modelDraft.dimIds.length === 0)
      return;
    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: modelDraft.code.trim(),
        name: modelDraft.name.trim(),
        description: modelDraft.description || null,
        dimensionIds: modelDraft.dimIds,
      }),
    });
    if (res.ok) {
      const body = await res.json();
      setShowNewModel(false);
      setModelDraft({ code: "", name: "", description: "", dimIds: [] });
      router.push(`/modeling/models/${body.id}`);
    } else {
      const b = await res.json().catch(() => ({}));
      setMsg(`⚠ ${b.message ?? b.error ?? "Oluşturulamadı"}`);
    }
  }

  // Yeni modelde secilebilir boyutlar: public olanlar + sahipsiz private'lar
  const selectableDims = dims.filter(
    (d) => d.visibility === "public" || d.ownerModelName == null
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-800">{t("nav.modeling")}</h1>
        {canEdit && (
          <>
            <button
              onClick={() => {
                setShowNewDim(!showNewDim);
                setShowNewModel(false);
              }}
              className="rounded-lg border border-blue-500 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
            >
              {t("pg.modeling.newDim")}
            </button>
            <button
              onClick={() => {
                setShowNewModel(!showNewModel);
                setShowNewDim(false);
              }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {t("pg.modeling.newModel")}
            </button>
          </>
        )}
        {msg && <span className="text-sm text-amber-600">{msg}</span>}
      </div>

      {showNewDim && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4">
          <label className="flex flex-col text-xs text-slate-500">
            Kod (ör. PRODUCT)
            <input
              value={dimDraft.code}
              onChange={(e) => setDimDraft({ ...dimDraft, code: e.target.value.toUpperCase() })}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Ad
            <input
              value={dimDraft.name}
              onChange={(e) => setDimDraft({ ...dimDraft, name: e.target.value })}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Tip
            <select
              value={dimDraft.type}
              onChange={(e) => setDimDraft({ ...dimDraft, type: e.target.value })}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="standard">Standart</option>
              <option value="time">Zaman</option>
              <option value="version">Versiyon</option>
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Görünürlük
            <select
              value={dimDraft.visibility}
              onChange={(e) =>
                setDimDraft({ ...dimDraft, visibility: e.target.value as "public" | "private" })
              }
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="public">🌐 Public (tüm modeller)</option>
              <option value="private">🔒 Private (tek model)</option>
            </select>
          </label>
          <button
            onClick={createDim}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Oluştur →
          </button>
        </div>
      )}

      {showNewModel && (
        <div className="mt-4 rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Kod (ör. SALES_PLAN)
              <input
                value={modelDraft.code}
                onChange={(e) => setModelDraft({ ...modelDraft, code: e.target.value.toUpperCase() })}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Ad
              <input
                value={modelDraft.name}
                onChange={(e) => setModelDraft({ ...modelDraft, name: e.target.value })}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="flex w-72 flex-col text-xs text-slate-500">
              Açıklama
              <input
                value={modelDraft.description}
                onChange={(e) => setModelDraft({ ...modelDraft, description: e.target.value })}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <button
              onClick={createModel}
              disabled={modelDraft.dimIds.length === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Oluştur ({modelDraft.dimIds.length} boyut) →
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Boyutları seç (tıklama sırası = slot):</span>
            {selectableDims.map((d) => {
              const idx = modelDraft.dimIds.indexOf(d.id);
              return (
                <button
                  key={d.id}
                  onClick={() =>
                    setModelDraft({
                      ...modelDraft,
                      dimIds:
                        idx >= 0
                          ? modelDraft.dimIds.filter((x) => x !== d.id)
                          : [...modelDraft.dimIds, d.id],
                    })
                  }
                  className={`rounded-lg border px-3 py-1 text-sm ${
                    idx >= 0
                      ? "border-blue-500 bg-blue-100 text-blue-800"
                      : "border-slate-300 bg-white text-slate-600"
                  }`}
                >
                  {idx >= 0 ? `${idx + 1}. ` : ""}
                  {d.visibility === "private" ? "🔒 " : ""}
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Modeller */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {t("pg.modeling.models")}
      </h2>
      <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left">Model</th>
              <th className="px-5 py-2.5 text-left">Kod</th>
              <th className="px-5 py-2.5 text-left">Boyutlar</th>
              <th className="px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {models.map((m) => (
              <tr
                key={m.id}
                onClick={() => router.push(`/modeling/models/${m.id}`)}
                className="cursor-pointer hover:bg-blue-50/50"
              >
                <td className="px-5 py-3 font-medium">🧊 {m.name}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-400">{m.code}</td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {m.dims.map((d) => d.name).join(" × ")}
                </td>
                <td className="px-5 py-3 text-right text-slate-300">›</td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-sm text-slate-400">
                  Henüz model yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Boyutlar */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {t("pg.modeling.dims")}
      </h2>
      <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left">Boyut</th>
              <th className="px-5 py-2.5 text-left">Kod</th>
              <th className="px-5 py-2.5 text-left">Tip</th>
              <th className="px-5 py-2.5 text-left">Görünürlük</th>
              <th className="px-5 py-2.5 text-right">Üye</th>
              <th className="px-5 py-2.5 text-left">Kullanan Modeller</th>
              <th className="px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {dims.map((d) => (
              <tr
                key={d.id}
                onClick={() => router.push(`/modeling/dimensions/${d.id}`)}
                className="cursor-pointer hover:bg-blue-50/50"
              >
                <td className="px-5 py-3 font-medium">❖ {d.name}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-400">{d.code}</td>
                <td className="px-5 py-3 text-xs">{TYPE_LABEL[d.type] ?? d.type}</td>
                <td className="px-5 py-3 text-xs">
                  {d.visibility === "private" ? (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
                      🔒 Private{d.ownerModelName ? ` · ${d.ownerModelName}` : ""}
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">🌐 Public</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{d.members.length}</td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {d.usedIn.map((m) => m.name).join(", ") || "—"}
                </td>
                <td className="px-5 py-3 text-right text-slate-300">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Satıra tıklayarak detay sayfasına git. Üye ve hiyerarşi yönetimi boyut sayfasında;
        veri ve rapor bilgisi model sayfasında. <Link href="/browser" className="text-blue-500 hover:underline">Veri Gözat →</Link>
      </p>
    </div>
  );
}
