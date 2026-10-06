"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  createPivotEngine,
  PIVOT_SEP,
  type PivotDim,
  type PivotEngine,
  type PivotViewRow,
} from "@/lib/pivot";
import {
  DEFAULT_OPTIONS,
  migrateDef,
  styleFor,
  type CalcColumn,
  type CalcRow,
  type CondRule,
  type ExportPayload,
  type ReportDefV2,
  type ReportOptions,
} from "@/lib/report-types";
import { compileFormula } from "@/lib/formula";
import PivotGrid, { STYLE_CLASS } from "@/components/PivotGrid";
import MemberPicker from "@/components/MemberPicker";
import DrillModal from "@/components/DrillModal";
import { getT, readLocaleClient } from "@/lib/i18n";
import { useVersionConflict } from "@/lib/hooks/useVersionConflict";

type Dim = PivotDim & { id: number; slot: number };
type Model = { id: number; code: string; name: string; dims: Dim[] };
type SavedReport = { id: number; name: string; ownerName: string; shared: number; mine: boolean };
type Comment = {
  id: number;
  cellKey: string | null;
  text: string;
  createdAt: string;
  userName: string;
};

const STYLE_LABEL: Array<[CondRule["style"], string]> = [
  ["red-text", "Kırmızı yazı"],
  ["green-text", "Yeşil yazı"],
  ["red-bg", "Kırmızı dolgu"],
  ["green-bg", "Yeşil dolgu"],
  ["yellow-bg", "Sarı dolgu"],
];

type Zone = "rows" | "cols" | "unused";

const ZONE_ORDER: Zone[] = ["unused", "rows", "cols"];
const ZONE_LABELS: Record<Zone, string> = {
  rows: "Satırlar",
  cols: "Sütunlar",
  unused: "Kullanılmayan",
};

// Sag paneldeki katlanir bolum
function Section({
  title,
  badge,
  defaultOpen,
  children,
}: {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-b border-slate-100">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
      >
        <span className="text-slate-300">{open ? "▾" : "▸"}</span>
        {title}
        {badge != null && badge !== 0 && (
          <span className="rounded-full bg-blue-100 px-1.5 text-[10px] text-blue-700">{badge}</span>
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function DimChip({
  code,
  zone,
  dims,
  items,
  onMove,
}: {
  code: string;
  zone: Zone;
  dims: Dim[];
  items: string[];
  onMove: (code: string, to: Zone, beforeCode?: string) => void;
}) {
  const dim = dims.find((d) => d.code === code);
  if (!dim) return null;
  const idx = items.indexOf(code);

  // Klavye eşdeğeri (a11y): fare ile sürükleme olmadan da taşıma yapılabilsin.
  // ↑/↓ aynı bölge içinde sıralamayı değiştirir, ←/→ bölgeler arası taşır.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (items.length < 2) return;
      e.preventDefault();
      if (e.key === "ArrowUp" && idx > 0) {
        onMove(code, zone, items[idx - 1]);
      } else if (e.key === "ArrowDown" && idx < items.length - 1) {
        onMove(code, zone, items[idx + 2]);
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const zoneIdx = ZONE_ORDER.indexOf(zone);
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const nextZone = ZONE_ORDER[(zoneIdx + delta + ZONE_ORDER.length) % ZONE_ORDER.length];
      onMove(code, nextZone);
    }
  }

  return (
    <span
      draggable
      tabIndex={0}
      role="button"
      aria-roledescription="sürüklenebilir boyut"
      aria-label={`${dim.name}, ${ZONE_LABELS[zone]} bölgesinde, konum ${idx + 1}/${items.length}. Taşımak için ok tuşlarını kullanın.`}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", code)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const dragged = e.dataTransfer.getData("text/plain");
        if (dragged && dragged !== code) onMove(dragged, zone, code);
      }}
      className="flex cursor-grab select-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm hover:border-blue-400 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      title="Sürükle veya odaklanıp ok tuşlarıyla taşı"
    >
      <span className="text-slate-300">⠿</span> {dim.name}
    </span>
  );
}

function DropZone({
  zone,
  label,
  items,
  hint,
  dims,
  onMove,
}: {
  zone: Zone;
  label: string;
  items: string[];
  hint: string;
  dims: Dim[];
  onMove: (code: string, to: Zone, beforeCode?: string) => void;
}) {
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const dragged = e.dataTransfer.getData("text/plain");
        if (dragged) onMove(dragged, zone);
      }}
      className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-2"
    >
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="flex flex-col gap-1.5">
        {items.map((c) => (
          <DimChip key={c} code={c} zone={zone} dims={dims} items={items} onMove={onMove} />
        ))}
        {items.length === 0 && <span className="py-1 text-center text-xs text-slate-300">{hint}</span>}
      </div>
    </div>
  );
}

function IconBtn({
  icon,
  title,
  onClick,
  disabled,
  active,
  danger,
}: {
  icon: string;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors disabled:opacity-30 ${
        active
          ? "bg-blue-100 text-blue-700"
          : danger
            ? "text-red-400 hover:bg-red-50 hover:text-red-600"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {icon}
    </button>
  );
}

export default function ReportsPage() {
  const t = getT(readLocaleClient());
  const searchParams = useSearchParams();
  const [models, setModels] = useState<Model[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [reportName, setReportName] = useState("Yeni Rapor");
  const [shared, setShared] = useState(false);
  const [isMine, setIsMine] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "view">("edit");

  const fetchLatestReport = useCallback(async (id: number) => {
    const res = await fetch(`/api/reports/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as { version: number };
  }, []);
  const versionGuard = useVersionConflict({
    entityId: currentId,
    isMine,
    fetchLatest: fetchLatestReport,
  });

  const [modelId, setModelId] = useState<number | null>(null);
  const [rowsZone, setRowsZone] = useState<string[]>([]);
  const [colsZone, setColsZone] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [calcColumns, setCalcColumns] = useState<CalcColumn[]>([]);
  const [calcRows, setCalcRows] = useState<CalcRow[]>([]);
  const [condRules, setCondRules] = useState<CondRule[]>([]);
  const [options, setOptions] = useState<ReportOptions>({ ...DEFAULT_OPTIONS });

  const [engine, setEngine] = useState<PivotEngine | null>(null);
  const [engineDims, setEngineDims] = useState<{ rows: Dim[]; cols: Dim[] }>({ rows: [], cols: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [drill, setDrill] = useState<{ filters: Record<string, string[]>; title: string } | null>(null);
  const [lastCell, setLastCell] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [attachCell, setAttachCell] = useState(false);

  const [calcDraft, setCalcDraft] = useState({ name: "", formula: "" });
  const [calcRowDraft, setCalcRowDraft] = useState({ name: "", formula: "" });
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<CondRule>({ target: "*", op: "<", value: 0, style: "red-text" });

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);
  const unusedZone = useMemo(
    () =>
      model
        ? model.dims.map((d) => d.code).filter((c) => !rowsZone.includes(c) && !colsZone.includes(c))
        : [],
    [model, rowsZone, colsZone]
  );

  function loadSavedList() {
    fetch("/api/reports").then((r) => r.json()).then(setSaved);
  }

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        // Bildirimden/derin baglantidan gelen rapor id'si varsa onu ac
        const linkedId = searchParams.get("id");
        if (linkedId) {
          loadReport(Number(linkedId));
          return;
        }
        // AI Sorgu sayfasindan gelen tanim varsa uygula ve calistir
        const aiRaw = typeof window !== "undefined" ? sessionStorage.getItem("planrep_ai_def") : null;
        if (aiRaw) {
          sessionStorage.removeItem("planrep_ai_def");
          try {
            const def = migrateDef(JSON.parse(aiRaw));
            const m = list.find((x) => x.id === def.modelId);
            if (m) {
              applyDef(def, "AI Raporu");
              setMode("view");
              runWith(m, def.rows, def.cols, def.filters);
              return;
            }
          } catch {
            /* bozuk tanim */
          }
        }
        if (list.length > 0) applyModelDefaults(list[0]);
      });
    loadSavedList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyModelDefaults(m: Model) {
    setModelId(m.id);
    const time = m.dims.find((d) => d.code === "TIME");
    const lastDim = m.dims[m.dims.length - 1];
    setRowsZone([lastDim?.code ?? m.dims[0].code]);
    setColsZone([time && time !== lastDim ? time.code : m.dims[0].code]);
    setFilters({});
    setEngine(null);
  }

  function applyDef(def: ReportDefV2, name: string) {
    setModelId(def.modelId);
    setRowsZone(def.rows);
    setColsZone(def.cols);
    setFilters(def.filters);
    setCalcColumns(def.calcColumns);
    setCalcRows(def.calcRows);
    setCondRules(def.condRules);
    setOptions(def.options);
    setReportName(name);
    setEngine(null);
  }

  // --- Suruklebirak ---
  function moveDim(code: string, to: Zone, beforeCode?: string) {
    const removeFrom = (arr: string[]) => arr.filter((c) => c !== code);
    let rows = removeFrom(rowsZone);
    let cols = removeFrom(colsZone);
    const insert = (arr: string[]) => {
      const idx = beforeCode ? arr.indexOf(beforeCode) : -1;
      if (idx >= 0) arr.splice(idx, 0, code);
      else arr.push(code);
      return arr;
    };
    if (to === "rows") {
      if (rows.length >= 3) {
        setMsg("En fazla 3 satır boyutu");
        return;
      }
      rows = insert(rows);
    }
    if (to === "cols") {
      if (cols.length >= 2) {
        setMsg("En fazla 2 sütun boyutu");
        return;
      }
      cols = insert(cols);
    }
    setRowsZone(rows);
    setColsZone(cols);
    setMsg(null);
  }

  // --- Calistir ---
  async function runWith(m: Model, rows: string[], cols: string[], f: Record<string, string[]>) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/pivot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: m.id, rows, cols, filters: f }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg("Sorgu başarısız");
      return;
    }
    const { tuples } = await res.json();
    const rowDims = rows.map((c) => m.dims.find((d) => d.code === c)!);
    const colDims = cols.map((c) => m.dims.find((d) => d.code === c)!);
    const eng = createPivotEngine(rowDims, colDims, tuples);
    setEngine(eng);
    setEngineDims({ rows: rowDims, cols: colDims });
    setExpanded(eng.defaultExpanded());
  }

  async function run() {
    if (!model || rowsZone.length === 0 || colsZone.length === 0) {
      setMsg("En az bir satır ve bir sütun boyutu gerekli");
      return;
    }
    await runWith(model, rowsZone, colsZone, filters);
  }

  const view = useMemo(
    () =>
      engine?.view({
        expanded,
        hideZero: options.hideZero,
        sort: options.sort,
        topN: options.topN,
      }) ?? null,
    [engine, expanded, options.hideZero, options.sort, options.topN]
  );

  const calcRowsComputed = useMemo<PivotViewRow[]>(() => {
    if (!engine || !view) return [];
    return calcRows.map((cr) => {
      const cells: Record<string, number> = {};
      let total = 0;
      try {
        const compiled = compileFormula(cr.formula);
        for (const col of view.columns) {
          const v = compiled.run((ref) => engine.cellsForMember(ref).cells[col.key]);
          if (v != null) cells[col.key] = v;
        }
        total = compiled.run((ref) => engine.cellsForMember(ref).total) ?? 0;
      } catch {
        /* hatali formul */
      }
      return {
        id: `calc:${cr.id}`,
        path: [],
        name: cr.name,
        depth: 0,
        dimIndex: 0,
        hasChildren: false,
        expanded: false,
        isCalc: true,
        cells,
        total,
      };
    });
  }, [engine, view, calcRows]);

  const transform = useMemo(() => {
    return (v: number | undefined, colKey: string, rowTotal: number): number | null => {
      if (v == null || !view) return null;
      if (options.valueMode === "pctCol") {
        const ct = colKey === "TOPLAM" ? view.grandTotal : view.colTotals[colKey];
        return ct ? (v / ct) * 100 : null;
      }
      if (options.valueMode === "pctRow") {
        return rowTotal ? (v / rowTotal) * 100 : null;
      }
      return v / options.scale;
    };
  }, [options.valueMode, options.scale, view]);

  const format = useMemo(() => {
    const nf = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: options.decimals,
      maximumFractionDigits: options.decimals,
    });
    const suffix = options.valueMode !== "abs" ? "%" : "";
    return (v: number | null) => (v == null ? "—" : nf.format(v) + suffix);
  }, [options.decimals, options.valueMode]);

  function onSort(key: string) {
    setOptions((o) => {
      if (o.sort?.key !== key) return { ...o, sort: { key, dir: "desc" } };
      if (o.sort.dir === "desc") return { ...o, sort: { key, dir: "asc" } };
      return { ...o, sort: null };
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll(open: boolean) {
    if (!engine) return;
    if (!open) {
      setExpanded(new Set());
      return;
    }
    const next = new Set<string>();
    let frontier = engine.view({ expanded: new Set(), hideZero: false, sort: null, topN: null }).rows;
    for (let i = 0; i < 12; i++) {
      const withKids = frontier.filter((r) => r.hasChildren && !next.has(r.id));
      if (withKids.length === 0) break;
      withKids.forEach((r) => next.add(r.id));
      frontier = engine.view({ expanded: next, hideZero: false, sort: null, topN: null }).rows;
    }
    setExpanded(next);
  }

  // --- Drill-through ---
  function onCellClick(row: PivotViewRow, colKey: string | null) {
    if (row.isCalc || !model) return;
    setLastCell(`${row.id}|${colKey ?? "TOPLAM"}`);
    const f: Record<string, string[]> = { ...filters };
    row.path.forEach((code, i) => {
      const dim = engineDims.rows[i];
      if (dim) f[dim.code] = [code];
    });
    if (colKey != null) {
      colKey.split(PIVOT_SEP).forEach((code, i) => {
        const dim = engineDims.cols[i];
        if (dim) f[dim.code] = [code];
      });
    }
    setDrill({ filters: f, title: row.name });
  }

  // --- Kaydet / Yukle ---
  function currentDef(): ReportDefV2 | null {
    if (!model) return null;
    return {
      version: 2,
      modelId: model.id,
      rows: rowsZone,
      cols: colsZone,
      filters,
      calcColumns,
      calcRows,
      condRules,
      options,
    };
  }

  function newReport() {
    setCurrentId(null);
    setReportName("Yeni Rapor");
    setShared(false);
    setIsMine(true);
    setCalcColumns([]);
    setCalcRows([]);
    setCondRules([]);
    setOptions({ ...DEFAULT_OPTIONS });
    setEngine(null);
    setComments([]);
    setMode("edit");
    if (model) applyModelDefaults(model);
  }

  async function loadReport(id: number) {
    const res = await fetch(`/api/reports/${id}`);
    if (!res.ok) return;
    const r = await res.json();
    const def = migrateDef(r.definition);
    setCurrentId(r.id);
    setShared(r.shared);
    setIsMine(r.mine);
    versionGuard.syncVersion(r.version);
    applyDef(def, r.name);
    loadComments(r.id);
    setMode("view");
    const m = models.find((x) => x.id === def.modelId);
    if (m) runWith(m, def.rows, def.cols, def.filters);
  }

  async function save(force = false) {
    const def = currentDef();
    if (!def) return;
    setMsg(null);
    const payload = {
      name: reportName,
      definition: def,
      shared,
      ...(force ? {} : { expectedVersion: versionGuard.knownVersion ?? undefined }),
    };
    if (currentId != null && isMine) {
      const res = await fetch(`/api/reports/${currentId}`, {
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
      const res = await fetch("/api/reports", {
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
    loadSavedList();
  }

  async function removeReport() {
    if (currentId == null || !confirm("Bu rapor silinsin mi?")) return;
    await fetch(`/api/reports/${currentId}`, { method: "DELETE" });
    newReport();
    loadSavedList();
  }

  // --- Coklu-kullanici cakisma cozumleri (bkz. lib/hooks/useVersionConflict.ts) ---
  function conflictOverwrite() {
    save(true);
  }
  function conflictReload() {
    if (currentId != null) loadReport(currentId);
  }
  function remoteUpdateReload() {
    if (currentId != null) loadReport(currentId);
    versionGuard.dismissRemoteUpdated();
  }

  // --- Yorumlar ---
  function loadComments(id: number) {
    fetch(`/api/comments?entityType=report&entityId=${id}`)
      .then((r) => r.json())
      .then(setComments);
  }

  async function addComment() {
    if (currentId == null || !commentText.trim()) return;
    await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "report",
        entityId: String(currentId),
        cellKey: attachCell ? lastCell : null,
        text: commentText.trim(),
      }),
    });
    setCommentText("");
    setAttachCell(false);
    loadComments(currentId);
  }

  async function deleteComment(id: number) {
    await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (currentId != null) loadComments(currentId);
  }

  const commentCells = useMemo(
    () => new Set(comments.filter((c) => c.cellKey).map((c) => c.cellKey!)),
    [comments]
  );

  // --- Export ---
  function buildExportPayload(): ExportPayload | null {
    if (!view) return null;
    const twoLevel = view.columns.some((c) => c.labels.length > 1);
    const lastHeader = [
      ...view.columns.map((c) => c.labels[twoLevel ? 1 : 0] ?? c.labels[0]),
      "Toplam",
      ...calcColumns.map((cc) => `ƒ ${cc.name}`),
    ];
    const headerRows = twoLevel
      ? [[...view.columns.map((c) => c.labels[0]), "", ...calcColumns.map(() => "")], lastHeader]
      : [lastHeader];

    const allRows = [...view.rows, ...calcRowsComputed];
    const rows = allRows.map((r) => {
      const showValues = options.subtotals || !r.hasChildren || !r.expanded || r.isCalc;
      const calc = calcColumns.map((cc) => {
        try {
          const v = compileFormula(cc.formula).run((ref) =>
            ref === "TOPLAM" || ref === "TOTAL" ? r.total : r.cells[ref]
          );
          return { v: v ?? null, style: styleFor(condRules, `calc:${cc.id}`, v) };
        } catch {
          return { v: null, style: null };
        }
      });
      return {
        name: r.name,
        depth: r.depth,
        bold: r.hasChildren || r.isCalc,
        values: [
          ...view.columns.map((c) => ({
            v: showValues ? transform(r.cells[c.key], c.key, r.total) : null,
            style: showValues ? styleFor(condRules, c.key, r.cells[c.key]) : null,
          })),
          {
            v: showValues ? transform(r.total, "TOPLAM", r.total) : null,
            style: showValues ? styleFor(condRules, "TOPLAM", r.total) : null,
          },
          ...calc,
        ],
      };
    });
    const totals = [
      ...view.columns.map((c) => ({
        v: transform(view.colTotals[c.key], c.key, view.grandTotal),
        style: null,
      })),
      { v: transform(view.grandTotal, "TOPLAM", view.grandTotal), style: null },
      ...calcColumns.map((cc) => {
        try {
          const v = compileFormula(cc.formula).run((ref) =>
            ref === "TOPLAM" || ref === "TOTAL" ? view.grandTotal : view.colTotals[ref]
          );
          return { v: v ?? null, style: null };
        } catch {
          return { v: null, style: null };
        }
      }),
    ];
    return {
      name: reportName,
      rowHeader: engineDims.rows.map((d) => d.name).join(" / "),
      headerRows,
      rows,
      totals,
      decimals: options.decimals,
    };
  }

  async function exportFile(kind: "excel" | "pptx") {
    const payload = buildExportPayload();
    if (!payload) return;
    const res = await fetch(`/api/export/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setMsg(t("export.exportFailed"));
      return;
    }
    downloadBlob(await res.blob(), `${safeName()}.${kind === "excel" ? "xlsx" : "pptx"}`);
  }

  function exportCsv() {
    const p = buildExportPayload();
    if (!p) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines: string[] = [];
    for (const hr of p.headerRows) lines.push([esc(p.rowHeader), ...hr.map(esc)].join(";"));
    for (const r of p.rows) {
      lines.push(
        [
          esc(" ".repeat(r.depth * 2) + r.name),
          ...r.values.map((v) => (v.v != null ? String(v.v).replace(".", ",") : "")),
        ].join(";")
      );
    }
    lines.push(
      [esc("Genel Toplam"), ...p.totals.map((v) => (v.v != null ? String(v.v).replace(".", ",") : ""))].join(";")
    );
    downloadBlob(
      new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
      `${safeName()}.csv`
    );
  }

  function safeName() {
    return reportName.replace(/[^\wğüşöçıİĞÜŞÖÇ -]/g, "").trim() || "rapor";
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Formul editorleri ---
  function addCalcColumn() {
    setFormulaError(null);
    if (!calcDraft.name.trim() || !calcDraft.formula.trim()) return;
    try {
      compileFormula(calcDraft.formula);
    } catch (e) {
      setFormulaError(e instanceof Error ? e.message : "Formül hatalı");
      return;
    }
    setCalcColumns([
      ...calcColumns,
      { id: `c${Date.now().toString(36)}`, name: calcDraft.name.trim(), formula: calcDraft.formula.trim() },
    ]);
    setCalcDraft({ name: "", formula: "" });
  }

  function addCalcRow() {
    setFormulaError(null);
    if (!calcRowDraft.name.trim() || !calcRowDraft.formula.trim()) return;
    try {
      compileFormula(calcRowDraft.formula);
    } catch (e) {
      setFormulaError(e instanceof Error ? e.message : "Formül hatalı");
      return;
    }
    setCalcRows([
      ...calcRows,
      { id: `r${Date.now().toString(36)}`, name: calcRowDraft.name.trim(), formula: calcRowDraft.formula.trim() },
    ]);
    setCalcRowDraft({ name: "", formula: "" });
  }

  const ruleTargets: Array<[string, string]> = [
    ["*", "Tüm hücreler"],
    ...(view?.columns.map((c) => [c.key, c.labels.join(" / ")] as [string, string]) ?? []),
    ["TOPLAM", "Toplam"],
    ...calcColumns.map((cc) => [`calc:${cc.id}`, cc.name] as [string, string]),
  ];

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900";

  return (
    <div className="flex h-full flex-col">
      {/* COKLU-KULLANICI CAKISMA/GUNCELLEME BILDIRIMLERI */}
      {versionGuard.conflict && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden">
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
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800 print:hidden">
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
      {/* ARAC CUBUGU */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white px-3 py-2 shadow-sm print:hidden">
        <select
          value={currentId ?? ""}
          onChange={(e) => (e.target.value === "" ? newReport() : loadReport(Number(e.target.value)))}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 sm:w-auto"
        >
          <option value="">— Yeni rapor —</option>
          {saved.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {!r.mine ? ` (${r.ownerName})` : ""}
              {r.shared ? " 🔗" : ""}
            </option>
          ))}
        </select>
        {mode === "edit" ? (
          <input
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            className="w-44 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-semibold text-slate-800"
          />
        ) : (
          <span className="px-1 text-sm font-semibold text-slate-800">{reportName}</span>
        )}

        <span className="mx-1 h-5 w-px bg-slate-200" />
        <IconBtn icon="💾" title={currentId != null && isMine ? "Güncelle" : "Kaydet"} onClick={() => save()} />
        <IconBtn icon="🔗" title="Paylaş (aç/kapat)" active={shared} onClick={() => setShared(!shared)} />
        {currentId != null && (
          <IconBtn
            icon="💬"
            title={`Yorumlar (${comments.length})`}
            active={showComments}
            onClick={() => setShowComments(!showComments)}
          />
        )}
        {currentId != null && isMine && <IconBtn icon="🗑" title="Raporu sil" danger onClick={removeReport} />}

        <span className="mx-1 h-5 w-px bg-slate-200" />
        <IconBtn icon="📗" title="Excel'e aktar" disabled={!view} onClick={() => exportFile("excel")} />
        <IconBtn icon="📙" title="PowerPoint'e aktar" disabled={!view} onClick={() => exportFile("pptx")} />
        <IconBtn icon="📄" title="CSV indir" disabled={!view} onClick={exportCsv} />
        <IconBtn icon="🖨" title="Yazdır" disabled={!view} onClick={() => window.print()} />

        <span className="mx-1 h-5 w-px bg-slate-200" />
        <IconBtn icon="⊞" title="Tümünü aç" disabled={!engine} onClick={() => expandAll(true)} />
        <IconBtn icon="⊟" title="Tümünü kapat" disabled={!engine} onClick={() => expandAll(false)} />

        {msg && <span className="ml-1 text-xs text-slate-400">{msg}</span>}

        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-200 text-sm">
          <button
            onClick={() => setMode("edit")}
            className={`px-3 py-1.5 ${mode === "edit" ? "bg-slate-800 font-semibold text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            ✎ Düzenle
          </button>
          <button
            onClick={() => setMode("view")}
            className={`px-3 py-1.5 ${mode === "view" ? "bg-slate-800 font-semibold text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            👁 Görünüm
          </button>
        </div>
      </div>

      {/* FILTRE SATIRI */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl bg-white px-3 py-2 shadow-sm print:hidden">
        <span className="text-xs text-slate-400">🜄</span>
        {model?.dims.map((d) => (
          <MemberPicker
            key={d.code}
            label={d.name}
            members={d.members}
            selected={filters[d.code] ?? []}
            onChange={(codes) => setFilters({ ...filters, [d.code]: codes })}
          />
        ))}
        <button
          onClick={run}
          disabled={busy}
          className="ml-auto rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? t("common.running") : t("common.run")}
        </button>
      </div>

      {/* GOVDE: grid + duzenleme paneli */}
      <div className="mt-2 flex min-h-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1">
          {view ? (
            <>
              <PivotGrid
                view={view}
                rowHeader={engineDims.rows.map((d) => d.name).join(" / ")}
                calcRows={calcRowsComputed}
                calcColumns={calcColumns}
                condRules={condRules}
                subtotals={options.subtotals}
                transform={transform}
                format={format}
                sortKey={options.sort?.key ?? null}
                sortDir={options.sort?.dir ?? "desc"}
                onSort={onSort}
                onToggle={toggleExpand}
                onCellClick={onCellClick}
                commentCells={commentCells}
              />
              <div className="mt-1.5 text-[11px] text-slate-400 print:hidden">
                💡 Hücre → detay · Başlık → sıralama · ▸/▾ → hiyerarşi
              </div>
            </>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center text-sm text-slate-400 print:hidden">
              {t("pg.reports.sub")}
            </div>
          )}
        </div>

        {/* DUZENLEME PANELI */}
        {mode === "edit" && (
          <div className="w-72 shrink-0 overflow-hidden rounded-xl bg-white shadow-sm print:hidden">
            <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600">
              🛠 Tasarım
            </div>

            <Section title="Model & Boyutlar" defaultOpen>
              <select
                value={modelId ?? ""}
                onChange={(e) => {
                  const m = models.find((x) => x.id === Number(e.target.value));
                  if (m) applyModelDefaults(m);
                }}
                className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    🧊 {m.name}
                  </option>
                ))}
              </select>
              <div className="space-y-2">
                <DropZone zone="rows" label="Satırlar (iç içe)" items={rowsZone} hint="buraya sürükle" dims={model?.dims ?? []} onMove={moveDim} />
                <DropZone zone="cols" label="Sütunlar" items={colsZone} hint="buraya sürükle" dims={model?.dims ?? []} onMove={moveDim} />
                <DropZone zone="unused" label="Kullanılmayan" items={unusedZone} hint="—" dims={model?.dims ?? []} onMove={moveDim} />
              </div>
            </Section>

            <Section title="Görünüm" defaultOpen>
              <div className="space-y-2 text-sm text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={options.hideZero}
                    onChange={(e) => setOptions({ ...options, hideZero: e.target.checked })}
                  />
                  Sıfırları gizle
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={options.subtotals}
                    onChange={(e) => setOptions({ ...options, subtotals: e.target.checked })}
                  />
                  Ara toplamlar
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-400">
                    Görünüm
                    <select
                      value={options.valueMode}
                      onChange={(e) =>
                        setOptions({ ...options, valueMode: e.target.value as ReportOptions["valueMode"] })
                      }
                      className={inputCls}
                    >
                      <option value="abs">Değer</option>
                      <option value="pctRow">Satır %</option>
                      <option value="pctCol">Sütun %</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">
                    Ölçek
                    <select
                      value={options.scale}
                      onChange={(e) =>
                        setOptions({ ...options, scale: Number(e.target.value) as ReportOptions["scale"] })
                      }
                      className={inputCls}
                    >
                      <option value={1}>Birim</option>
                      <option value={1000}>Bin</option>
                      <option value={1000000}>Milyon</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">
                    Ondalık
                    <select
                      value={options.decimals}
                      onChange={(e) =>
                        setOptions({ ...options, decimals: Number(e.target.value) as ReportOptions["decimals"] })
                      }
                      className={inputCls}
                    >
                      <option value={0}>0</option>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">
                    Top-N
                    <input
                      type="number"
                      min={0}
                      value={options.topN ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        setOptions({ ...options, topN: e.target.value ? Number(e.target.value) : null })
                      }
                      className={inputCls}
                    />
                  </label>
                </div>
              </div>
            </Section>

            <Section title="ƒ Hesaplanan Kolonlar" badge={calcColumns.length}>
              {calcColumns.map((cc) => (
                <div key={cc.id} className="mb-1 flex items-center gap-2 rounded-lg bg-blue-50 px-2 py-1 text-xs">
                  <span className="font-medium text-slate-700">{cc.name}</span>
                  <code className="truncate text-[10px] text-slate-400">{cc.formula}</code>
                  <button
                    onClick={() => setCalcColumns(calcColumns.filter((x) => x.id !== cc.id))}
                    className="ml-auto text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <input
                value={calcDraft.name}
                onChange={(e) => setCalcDraft({ ...calcDraft, name: e.target.value })}
                placeholder="Kolon adı (Varyans)"
                className={inputCls}
              />
              <input
                value={calcDraft.formula}
                onChange={(e) => setCalcDraft({ ...calcDraft, formula: e.target.value })}
                placeholder="[BUDGET]-[ACTUAL]"
                className={`${inputCls} font-mono`}
              />
              <button
                onClick={addCalcColumn}
                className="mt-2 w-full rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {t("common.add")}
              </button>
              {view && (
                <div className="mt-1.5 text-[10px] text-slate-400">
                  Anahtarlar: {[...view.columns.map((c) => c.key), "TOPLAM"].map((c) => `[${c}]`).join(" ")}
                </div>
              )}
              <div className="mt-1 text-[10px] text-slate-400">
                Fonksiyonlar: IF(kosul;evet;hayır), SUM(...), AVG(...), MIN(...), MAX(...),
                SUMIF(kosul1;değer1;kosul2;değer2;...) — argümanlar{" "}
                <code>;</code> ile ayrılır. Zaman ofseti: <code>[2026-03.PY]</code> (önceki yıl),{" "}
                <code>[2026-03.MOVAVG(3)]</code> (hareketli ortalama).
              </div>
            </Section>

            <Section title="ƒ Hesaplanan Satırlar" badge={calcRows.length}>
              {calcRows.map((cr) => (
                <div key={cr.id} className="mb-1 flex items-center gap-2 rounded-lg bg-violet-50 px-2 py-1 text-xs">
                  <span className="font-medium text-slate-700">{cr.name}</span>
                  <code className="truncate text-[10px] text-slate-400">{cr.formula}</code>
                  <button
                    onClick={() => setCalcRows(calcRows.filter((x) => x.id !== cr.id))}
                    className="ml-auto text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <input
                value={calcRowDraft.name}
                onChange={(e) => setCalcRowDraft({ ...calcRowDraft, name: e.target.value })}
                placeholder="Satır adı (Brüt Kâr)"
                className={inputCls}
              />
              <input
                value={calcRowDraft.formula}
                onChange={(e) => setCalcRowDraft({ ...calcRowDraft, formula: e.target.value })}
                placeholder="[REVENUE]+[OPEX]"
                className={`${inputCls} font-mono`}
              />
              <button
                onClick={addCalcRow}
                className="mt-2 w-full rounded-lg bg-violet-600 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
              >
                {t("common.add")}
              </button>
              {engineDims.rows[0] && (
                <div className="mt-1.5 text-[10px] text-slate-400">
                  Üyeler:{" "}
                  {engineDims.rows[0].members.slice(0, 8).map((m) => `[${m.code}]`).join(" ")}
                  {engineDims.rows[0].members.length > 8 ? " ..." : ""}
                </div>
              )}
              {formulaError && <div className="mt-1 text-[10px] text-red-500">{formulaError}</div>}
            </Section>

            <Section title="🎨 Koşullu Biçim" badge={condRules.length}>
              {condRules.map((r, i) => (
                <div key={i} className="mb-1 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px]">
                  <span className="truncate">
                    {ruleTargets.find(([code]) => code === r.target)?.[1] ?? r.target} <b>{r.op}</b> {r.value}
                  </span>
                  <span className={`rounded px-1 text-[10px] ${STYLE_CLASS[r.style]}`}>
                    {STYLE_LABEL.find(([s]) => s === r.style)?.[1]}
                  </span>
                  <button
                    onClick={() => setCondRules(condRules.filter((_, j) => j !== i))}
                    className="ml-auto text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 text-xs text-slate-400">
                  Hedef
                  <select
                    value={ruleDraft.target}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, target: e.target.value })}
                    className={inputCls}
                  >
                    {ruleTargets.map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Koşul
                  <select
                    value={ruleDraft.op}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, op: e.target.value as CondRule["op"] })}
                    className={inputCls}
                  >
                    {["<", ">", "<=", ">=", "="].map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Değer
                  <input
                    type="number"
                    value={ruleDraft.value}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, value: Number(e.target.value) })}
                    className={inputCls}
                  />
                </label>
                <label className="col-span-2 text-xs text-slate-400">
                  Stil
                  <select
                    value={ruleDraft.style}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, style: e.target.value as CondRule["style"] })}
                    className={inputCls}
                  >
                    {STYLE_LABEL.map(([s, label]) => (
                      <option key={s} value={s}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                onClick={() => setCondRules([...condRules, { ...ruleDraft }])}
                className="mt-2 w-full rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {t("common.add")}
              </button>
            </Section>
          </div>
        )}
      </div>

      {/* Drill-through */}
      {drill && model && (
        <DrillModal modelId={model.id} filters={drill.filters} title={drill.title} onClose={() => setDrill(null)} />
      )}

      {/* Yorum paneli */}
      {showComments && currentId != null && (
        <div className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-slate-200 bg-white shadow-2xl print:hidden">
          <div className="flex items-center border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-800">💬 Yorumlar</h3>
            <button onClick={() => setShowComments(false)} className="ml-auto text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex items-baseline gap-2 text-xs text-slate-400">
                  <b className="text-slate-600">{c.userName}</b>
                  {new Date(c.createdAt).toLocaleString("tr-TR")}
                  <button onClick={() => deleteComment(c.id)} className="ml-auto text-red-300 hover:text-red-500">
                    sil
                  </button>
                </div>
                {c.cellKey && <div className="mt-0.5 font-mono text-[10px] text-amber-600">📍 {c.cellKey}</div>}
                <div className="mt-1 text-slate-700">{c.text}</div>
              </div>
            ))}
            {comments.length === 0 && <div className="text-sm text-slate-400">Henüz yorum yok.</div>}
          </div>
          <div className="border-t border-slate-100 p-3">
            {lastCell && (
              <label className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={attachCell} onChange={(e) => setAttachCell(e.target.checked)} />
                Son tıklanan hücreye iliştir <span className="font-mono text-[10px]">{lastCell}</span>
              </label>
            )}
            <div className="flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addComment()}
                placeholder="Yorum yaz..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
              <button
                onClick={addComment}
                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600"
              >
                Gönder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
