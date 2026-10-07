"use client";

// Kayitli bir raporu (pivot grid) salt-okunur olarak render eder.
// Dashboard "Tam Rapor" widget'i ve gelecekte story sayfalari bunu kullanir.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPivotEngine, type PivotDim, type PivotEngine, type PivotViewRow } from "@/lib/pivot";
import { migrateDef, type ReportDefV2 } from "@/lib/report-types";
import { compileFormula } from "@/lib/formula";
import { withTimeOffsets } from "@/lib/time-offset";
import PivotGrid from "@/components/PivotGrid";

type Dim = PivotDim & { id: number };
type Model = { id: number; name: string; dims: Dim[] };

export default function ReportView({
  reportId,
  extraFilters,
}: {
  reportId: number;
  extraFilters?: Record<string, string[]>;
}) {
  const [def, setDef] = useState<ReportDefV2 | null>(null);
  const [engine, setEngine] = useState<PivotEngine | null>(null);
  const [dims, setDims] = useState<{ rows: Dim[]; cols: Dim[] }>({ rows: [], cols: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [error, setError] = useState(false);
  const [joinValues, setJoinValues] = useState<Record<string, Record<string, number>>>({});

  const extraKey = JSON.stringify(extraFilters ?? {});
  const aliveRef = useRef(true);

  const load = useCallback(() => {
    Promise.resolve()
      .then(() => {
        setError(false);
        setEngine(null);
      })
      .then(async () => {
        const rRes = await fetch(`/api/reports/${reportId}`);
        if (!rRes.ok) throw new Error();
        const report = await rRes.json();
        const d = migrateDef(report.definition);
        const mRes = await fetch("/api/models");
        const models: Model[] = await mRes.json();
        const model = models.find((m) => m.id === d.modelId);
        if (!model) throw new Error();

        const filters = { ...d.filters, ...(JSON.parse(extraKey) as Record<string, string[]>) };
        const pRes = await fetch("/api/pivot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: d.modelId,
            rows: d.rows,
            cols: d.cols,
            filters,
            measureCode: d.measureCode,
            joins: d.joins,
          }),
        });
        if (!pRes.ok) throw new Error();
        const { tuples, joinValues: jv } = await pRes.json();

        const rowDims = d.rows.map((c) => model.dims.find((x) => x.code === c)!);
        const colDims = d.cols.map((c) => model.dims.find((x) => x.code === c)!);
        const eng = createPivotEngine(rowDims, colDims, tuples);
        if (!aliveRef.current) return;
        setDef(d);
        setDims({ rows: rowDims, cols: colDims });
        setEngine(eng);
        setJoinValues(jv ?? {});
        setExpanded(eng.defaultExpanded());
        setSort(d.options.sort);
      })
      .catch(() => {
        if (aliveRef.current) setError(true);
      });
  }, [reportId, extraKey]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const view = useMemo(
    () =>
      engine && def
        ? engine.view({
            expanded,
            hideZero: def.options.hideZero,
            sort,
            topN: def.options.topN,
          })
        : null,
    [engine, def, expanded, sort]
  );

  const calcRowsComputed = useMemo<PivotViewRow[]>(() => {
    if (!engine || !view || !def) return [];
    return def.calcRows.map((cr) => {
      const cells: Record<string, number> = {};
      let total = 0;
      try {
        const compiled = compileFormula(cr.formula);
        for (const col of view.columns) {
          const v = compiled.run(withTimeOffsets((ref) => engine.cellsForMember(ref).cells[col.key]));
          if (v != null) cells[col.key] = v;
        }
        total = compiled.run(withTimeOffsets((ref) => engine.cellsForMember(ref).total)) ?? 0;
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
  }, [engine, view, def]);

  const transform = useMemo(() => {
    return (v: number | undefined, colKey: string, rowTotal: number): number | null => {
      if (v == null || !view || !def) return null;
      if (def.options.valueMode === "pctCol") {
        const ct = colKey === "TOPLAM" ? view.grandTotal : view.colTotals[colKey];
        return ct ? (v / ct) * 100 : null;
      }
      if (def.options.valueMode === "pctRow") return rowTotal ? (v / rowTotal) * 100 : null;
      return v / def.options.scale;
    };
  }, [view, def]);

  const format = useMemo(() => {
    const decimals = def?.options.decimals ?? 0;
    const nf = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    const suffix = def && def.options.valueMode !== "abs" ? "%" : "";
    return (v: number | null) => (v == null ? "—" : nf.format(v) + suffix);
  }, [def]);

  if (error) return <div className="text-sm text-red-500">Rapor yüklenemedi</div>;
  if (!view || !def) return <div className="text-sm text-slate-400">Yükleniyor...</div>;

  return (
    <div className="max-h-96 overflow-auto">
      <PivotGrid
        view={view}
        rowHeader={dims.rows.map((d) => d.name).join(" / ")}
        calcRows={calcRowsComputed}
        calcColumns={def.calcColumns}
        joinColumns={def.joins}
        joinValues={joinValues}
        condRules={def.condRules}
        subtotals={def.options.subtotals}
        transform={transform}
        format={format}
        sortKey={sort?.key ?? null}
        sortDir={sort?.dir ?? "desc"}
        onSort={(key) =>
          setSort((s) =>
            s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null
          )
        }
        onToggle={(id) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
    </div>
  );
}
