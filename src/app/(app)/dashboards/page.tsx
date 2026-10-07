"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import DashboardWidget, { type Widget, type WidgetType } from "@/components/DashboardWidget";
import MemberPicker from "@/components/MemberPicker";
import { migrateDef } from "@/lib/report-types";
import { getT, readLocaleClient } from "@/lib/i18n";
import type { Member } from "@/lib/pivot";
import { useVersionConflict } from "@/lib/hooks/useVersionConflict";
import { useHotkey } from "@/lib/shortcuts";

type Dim = { id: number; code: string; name: string; members: Member[] };
type MeasureInfo = { id: number; modelId: number; code: string; name: string; slot: number };
type Model = { id: number; code: string; name: string; dims: Dim[]; measures?: MeasureInfo[] };
type SavedDashboard = { id: number; name: string; ownerName: string; shared: number; mine: boolean };
type SavedReport = { id: number; name: string; mine: boolean; ownerName: string };

const WIDGET_TYPES: Array<[WidgetType, string]> = [
  ["kpi", "🔢 KPI Kartı"],
  ["bar", "📊 Çubuk Grafik"],
  ["line", "📈 Çizgi Grafik"],
  ["pie", "🍩 Halka Grafik"],
  ["table", "▦ Mini Tablo"],
  ["report", "📋 Tam Rapor (pivot)"],
];

export default function DashboardsPage() {
  const t = getT(readLocaleClient());
  const searchParams = useSearchParams();
  const [models, setModels] = useState<Model[]>([]);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [saved, setSaved] = useState<SavedDashboard[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [name, setName] = useState("Yeni Dashboard");
  const [shared, setShared] = useState(false);
  const [isMine, setIsMine] = useState(true);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [globalDims, setGlobalDims] = useState<string[]>([]);
  const [globalFilters, setGlobalFilters] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const fetchLatestDashboard = useCallback(async (id: number) => {
    const res = await fetch(`/api/dashboards/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as { version: number };
  }, []);
  const versionGuard = useVersionConflict({
    entityId: currentId,
    isMine,
    fetchLatest: fetchLatestDashboard,
  });

  useHotkey({ key: "s", mod: true }, () => void save());

  const [showForm, setShowForm] = useState(false);
  const [source, setSource] = useState<"manual" | "report">("manual");
  const [reportId, setReportId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{
    type: WidgetType;
    title: string;
    modelId: number | null;
    rowDim: string;
    colDim: string;
    measureCode: string;
    filters: Record<string, string>;
  }>({ type: "bar", title: "", modelId: null, rowDim: "", colDim: "", measureCode: "", filters: {} });

  const draftModel = useMemo(() => models.find((m) => m.id === draft.modelId) ?? null, [models, draft.modelId]);
  const allDims = useMemo(() => {
    const map = new Map<string, Dim>();
    for (const m of models) for (const d of m.dims) if (!map.has(d.code)) map.set(d.code, d);
    return [...map.values()];
  }, [models]);

  function loadList() {
    fetch("/api/dashboards").then((r) => r.json()).then(setSaved);
  }

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        if (list.length > 0) {
          const m = list[0];
          const time = m.dims.find((d) => d.code === "TIME");
          setDraft((d) => ({
            ...d,
            modelId: m.id,
            rowDim: m.dims[m.dims.length - 1]?.code ?? "",
            colDim: time?.code ?? m.dims[0].code,
          }));
        }
      });
    fetch("/api/reports").then((r) => r.json()).then(setReports);
    loadList();
    // Bildirimden/derin baglantidan gelen dashboard id'si varsa onu ac
    const linkedId = searchParams.get("id");
    if (linkedId) loadDashboard(Number(linkedId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newDashboard() {
    setCurrentId(null);
    setName("Yeni Dashboard");
    setShared(false);
    setIsMine(true);
    setWidgets([]);
    setGlobalDims([]);
    setGlobalFilters({});
  }

  async function loadDashboard(id: number) {
    const res = await fetch(`/api/dashboards/${id}`);
    if (!res.ok) return;
    const d = await res.json();
    setCurrentId(d.id);
    setName(d.name);
    setShared(d.shared);
    setIsMine(d.mine);
    versionGuard.syncVersion(d.version);
    setWidgets(d.definition?.widgets ?? []);
    setGlobalDims(d.definition?.globalDims ?? []);
    setGlobalFilters(d.definition?.globalFilters ?? {});
  }

  async function save(force = false) {
    setMsg(null);
    const payload = {
      name,
      definition: { widgets, globalDims, globalFilters },
      shared,
      ...(force ? {} : { expectedVersion: versionGuard.knownVersion ?? undefined }),
    };
    if (currentId != null && isMine) {
      const res = await fetch(`/api/dashboards/${currentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        if (body?.current) versionGuard.handleConflict(body.current);
        setMsg(t("collab.conflictShort"));
        return;
      }
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (typeof body.version === "number") versionGuard.syncVersion(body.version);
        setMsg("✅ Güncellendi");
      } else {
        setMsg("Kaydetme başarısız");
      }
    } else {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json();
        setCurrentId(body.id);
        setIsMine(true);
        versionGuard.syncVersion(1);
        setMsg("✅ Kaydedildi");
      } else setMsg("Kaydetme başarısız");
    }
    loadList();
  }

  async function removeDashboard() {
    if (currentId == null || !confirm("Bu dashboard silinsin mi?")) return;
    await fetch(`/api/dashboards/${currentId}`, { method: "DELETE" });
    newDashboard();
    loadList();
  }

  // --- Coklu-kullanici cakisma cozumleri (bkz. lib/hooks/useVersionConflict.ts) ---
  function conflictOverwrite() {
    save(true);
  }
  function conflictReload() {
    if (currentId != null) loadDashboard(currentId);
  }
  function remoteUpdateReload() {
    if (currentId != null) loadDashboard(currentId);
    versionGuard.dismissRemoteUpdated();
  }

  async function addWidget() {
    if (source === "report" || draft.type === "report") {
      if (reportId == null) return;
      const res = await fetch(`/api/reports/${reportId}`);
      if (!res.ok) return;
      const r = await res.json();
      const def = migrateDef(r.definition);
      setWidgets([
        ...widgets,
        {
          id: `w${Date.now().toString(36)}`,
          type: draft.type,
          title: draft.title.trim() || r.name,
          w: draft.type === "report" ? 2 : 1,
          ...(draft.type === "report" ? { reportId } : {}),
          query: {
            modelId: def.modelId,
            rowDim: def.rows[0],
            colDim: def.cols[0],
            filters: def.filters,
            measureCode: def.measureCode,
          },
        },
      ]);
      setShowForm(false);
      return;
    }
    if (!draftModel || !draft.rowDim || !draft.colDim || draft.rowDim === draft.colDim) return;
    const filters: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(draft.filters)) if (v) filters[k] = [v];
    setWidgets([
      ...widgets,
      {
        id: `w${Date.now().toString(36)}`,
        type: draft.type,
        title:
          draft.title.trim() ||
          `${draftModel.name} — ${draftModel.dims.find((d) => d.code === draft.rowDim)?.name ?? draft.rowDim}`,
        w: 1,
        query: { modelId: draftModel.id, rowDim: draft.rowDim, colDim: draft.colDim, filters, measureCode: draft.measureCode || undefined },
      },
    ]);
    setShowForm(false);
    setDraft({ ...draft, title: "" });
  }

  function moveWidget(dragId: string, beforeId: string) {
    if (dragId === beforeId) return;
    const list = widgets.filter((w) => w.id !== dragId);
    const dragged = widgets.find((w) => w.id === dragId);
    if (!dragged) return;
    const idx = list.findIndex((w) => w.id === beforeId);
    list.splice(idx < 0 ? list.length : idx, 0, dragged);
    setWidgets(list);
  }

  // Global filtrede secim yapilan boyutlar widget'lara uygulanir
  const activeGlobalFilters = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const code of globalDims) {
      const sel = globalFilters[code];
      if (sel && sel.length > 0) out[code] = sel;
    }
    return out;
  }, [globalDims, globalFilters]);

  const draftOtherDims = draftModel?.dims.filter((d) => d.code !== draft.rowDim && d.code !== draft.colDim) ?? [];

  return (
    <div>
      {versionGuard.conflict && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>⚠️ {t("collab.conflictBanner")}</span>
          <button
            onClick={conflictReload}
            className="ml-auto rounded-lg bg-white px-3 py-1 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-100"
          >
            {t("collab.reloadTheirs")}
          </button>
          <button
            onClick={conflictOverwrite}
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            {t("collab.overwriteMine")}
          </button>
        </div>
      )}
      {!versionGuard.conflict && versionGuard.remoteUpdated && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <span>ℹ️ {t("collab.remoteUpdateBanner")}</span>
          <button
            onClick={remoteUpdateReload}
            className="ml-auto rounded-lg bg-white px-3 py-1 text-xs font-medium text-blue-800 shadow-sm hover:bg-blue-100"
          >
            {t("collab.reloadTheirs")}
          </button>
          <button
            onClick={versionGuard.dismissRemoteUpdated}
            className="rounded-lg px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            {t("collab.dismiss")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-800">{t("nav.dashboards")}</h1>
        <select
          value={currentId ?? ""}
          onChange={(e) => (e.target.value === "" ? newDashboard() : loadDashboard(Number(e.target.value)))}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 sm:w-auto"
        >
          <option value="">— Yeni dashboard —</option>
          {saved.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {!d.mine ? ` (${d.ownerName})` : ""}
              {d.shared ? " 🔗" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 sm:w-auto"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {t("common.share")} 🔗
        </label>
        <button onClick={() => save()} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          💾 {currentId != null && isMine ? t("common.update") : t("common.save")}
        </button>
        {currentId != null && isMine && (
          <button onClick={removeDashboard} className="text-sm text-red-500 hover:text-red-700">
            Sil
          </button>
        )}
        <button
          onClick={() => setShowForm(!showForm)}
          className="ml-auto rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {t("pg.dashboards.addWidget")}
        </button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>

      {/* Global filtre cubugu */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-sm">
        <span className="text-xs font-semibold uppercase text-slate-400">🌐 Global Filtre:</span>
        {globalDims.map((code) => {
          const dim = allDims.find((d) => d.code === code);
          if (!dim) return null;
          return (
            <span key={code} className="flex items-center gap-1">
              <MemberPicker
                label={dim.name}
                members={dim.members}
                selected={globalFilters[code] ?? []}
                onChange={(codes) => setGlobalFilters({ ...globalFilters, [code]: codes })}
              />
              <button
                onClick={() => {
                  setGlobalDims(globalDims.filter((c) => c !== code));
                  const next = { ...globalFilters };
                  delete next[code];
                  setGlobalFilters(next);
                }}
                className="text-xs text-slate-300 hover:text-red-500"
              >
                ✕
              </button>
            </span>
          );
        })}
        <select
          value=""
          onChange={(e) => {
            if (e.target.value && !globalDims.includes(e.target.value)) {
              setGlobalDims([...globalDims, e.target.value]);
            }
          }}
          className="rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-500"
        >
          <option value="">+ filtre boyutu ekle</option>
          {allDims
            .filter((d) => !globalDims.includes(d.code))
            .map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
        </select>
        <span className="text-[10px] text-slate-300">Seçimler tüm widget&apos;lara uygulanır</span>
      </div>

      {showForm && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4">
          <label className="flex flex-col text-xs text-slate-500">
            Kaynak
            <select value={source} onChange={(e) => setSource(e.target.value as "manual" | "report")} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
              <option value="manual">Elle tanımla</option>
              <option value="report">Kayıtlı rapordan</option>
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Tür
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as WidgetType })} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
              {WIDGET_TYPES.map(([t, label]) => (
                <option key={t} value={t}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Başlık
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="(otomatik)" className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          </label>

          {source === "report" || draft.type === "report" ? (
            <label className="flex flex-col text-xs text-slate-500">
              Rapor
              <select value={reportId ?? ""} onChange={(e) => setReportId(Number(e.target.value))} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                <option value="">Seç...</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {!r.mine ? ` (${r.ownerName})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="flex flex-col text-xs text-slate-500">
                Model
                <select value={draft.modelId ?? ""} onChange={(e) => setDraft({ ...draft, modelId: Number(e.target.value), filters: {} })} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs text-slate-500">
                Seriler (satır)
                <select value={draft.rowDim} onChange={(e) => setDraft({ ...draft, rowDim: e.target.value })} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                  {draftModel?.dims.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs text-slate-500">
                Eksen (sütun)
                <select value={draft.colDim} onChange={(e) => setDraft({ ...draft, colDim: e.target.value })} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                  {draftModel?.dims.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {draftModel && draftModel.measures && draftModel.measures.length > 0 && (
                <label className="flex flex-col text-xs text-slate-500">
                  Ölçü
                  <select value={draft.measureCode} onChange={(e) => setDraft({ ...draft, measureCode: e.target.value })} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                    <option value="">(varsayılan)</option>
                    {draftModel.measures.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draftOtherDims.map((d) => (
                <label key={d.code} className="flex flex-col text-xs text-slate-500">
                  {d.name}
                  <select
                    value={draft.filters[d.code] ?? ""}
                    onChange={(e) => setDraft({ ...draft, filters: { ...draft.filters, [d.code]: e.target.value } })}
                    className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="">Tümü</option>
                    {d.members.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </>
          )}
          <button
            onClick={addWidget}
            disabled={
              source === "report" || draft.type === "report"
                ? reportId == null
                : draft.rowDim === draft.colDim
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Ekle
          </button>
        </div>
      )}

      {widgets.length === 0 ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
          &quot;+ Widget Ekle&quot; ile KPI kartı, grafik veya mini tablo ekle; başlıklarından sürükleyerek yerlerini değiştir.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {widgets.map((w, idx) => (
            <div
              key={w.id}
              className={w.w === 2 ? "lg:col-span-2" : ""}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dragId = e.dataTransfer.getData("widget/id");
                if (dragId) moveWidget(dragId, w.id);
              }}
            >
              <DashboardWidget
                widget={w}
                extraFilters={activeGlobalFilters}
                onRemove={isMine ? () => setWidgets(widgets.filter((x) => x.id !== w.id)) : undefined}
                onWiden={
                  isMine
                    ? () => setWidgets(widgets.map((x) => (x.id === w.id ? { ...x, w: x.w === 2 ? 1 : 2 } : x)))
                    : undefined
                }
                onMoveLeft={isMine && idx > 0 ? () => moveWidget(w.id, widgets[idx - 1].id) : undefined}
                onMoveRight={
                  isMine && idx < widgets.length - 1 ? () => moveWidget(widgets[idx + 1].id, w.id) : undefined
                }
                dragHandleProps={
                  isMine
                    ? {
                        draggable: true,
                        onDragStart: (e: React.DragEvent) => e.dataTransfer.setData("widget/id", w.id),
                      }
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
