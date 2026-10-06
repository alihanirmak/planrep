"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { QueryResult } from "@/lib/report-types";
import ReportView from "@/components/ReportView";

// Dogrulanmis kategorik palet — sabit sira, asla dondurulmez (dataviz referans paleti, light)
const SERIES_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];
const INK_MUTED = "#898781";
const GRIDLINE = "#e1e0d9";
const MAX_SERIES = 8;

export type WidgetType = "kpi" | "bar" | "line" | "pie" | "table" | "report";

export type Widget = {
  id: string;
  type: WidgetType;
  title: string;
  w?: 1 | 2; // grid genisligi (kolon)
  reportId?: number; // type === "report" icin
  query: {
    modelId: number;
    rowDim: string;
    colDim: string;
    filters: Record<string, string[]>;
  };
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const nfCompact = new Intl.NumberFormat("tr-TR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type SeriesRow = { code: string; name: string; cells: Record<string, number>; total: number };

// Ust seviye satirlar seri olur; fazlasi "Diğer" altinda toplanir
function topSeries(data: QueryResult): SeriesRow[] {
  const top = data.rows.filter((r) => r.depth === 0);
  if (top.length <= MAX_SERIES) return top;
  const kept = top.slice(0, MAX_SERIES - 1);
  const rest = top.slice(MAX_SERIES - 1);
  const other: SeriesRow = { code: "__other", name: "Diğer", cells: {}, total: 0 };
  for (const r of rest) {
    other.total += r.total;
    for (const [c, v] of Object.entries(r.cells)) {
      other.cells[c] = (other.cells[c] ?? 0) + v;
    }
  }
  return [...kept, other];
}

function toChartData(data: QueryResult, series: SeriesRow[]) {
  return data.cols.map((c) => {
    const point: Record<string, string | number | null> = { name: c.name };
    for (const s of series) point[s.name] = s.cells[c.code] ?? null;
    return point;
  });
}

export default function DashboardWidget({
  widget,
  onRemove,
  onWiden,
  onMoveLeft,
  onMoveRight,
  extraFilters,
  dragHandleProps,
}: {
  widget: Widget;
  onRemove?: () => void;
  onWiden?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  extraFilters?: Record<string, string[]>;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [error, setError] = useState(false);
  const mergedFilters = JSON.stringify({ ...widget.query.filters, ...(extraFilters ?? {}) });

  const isReport = widget.type === "report";
  const aliveRef = useRef(true);

  const load = useCallback(() => {
    Promise.resolve()
      .then(() => {
        setData(null);
        setError(false);
      })
      .then(() =>
        fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...widget.query, filters: JSON.parse(mergedFilters) }),
        })
      )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => aliveRef.current && setData(d))
      .catch(() => aliveRef.current && setError(true));
  }, [widget, mergedFilters]);

  useEffect(() => {
    if (isReport) return; // tam rapor widget'i ReportView kendi verisini ceker
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [isReport, load]);

  return (
    <div className="flex min-h-64 flex-col rounded-xl bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center" {...dragHandleProps}>
        <h3 className={`text-sm font-semibold text-slate-700 ${dragHandleProps ? "cursor-grab" : ""}`}>
          {dragHandleProps ? "⠿ " : ""}
          {widget.title}
        </h3>
        {(onMoveLeft || onMoveRight) && (
          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={onMoveLeft}
              disabled={!onMoveLeft}
              className="text-xs text-slate-300 hover:text-blue-500 disabled:opacity-30 disabled:hover:text-slate-300"
              title="Widget'ı sola taşı"
              aria-label="Widget'ı sola taşı"
            >
              ◀
            </button>
            <button
              onClick={onMoveRight}
              disabled={!onMoveRight}
              className="text-xs text-slate-300 hover:text-blue-500 disabled:opacity-30 disabled:hover:text-slate-300"
              title="Widget'ı sağa taşı"
              aria-label="Widget'ı sağa taşı"
            >
              ▶
            </button>
          </span>
        )}
        {onWiden && (
          <button
            onClick={onWiden}
            className="ml-auto mr-2 text-xs text-slate-300 hover:text-blue-500"
            title="Genişlik değiştir"
          >
            ⇔
          </button>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className={`${onWiden ? "" : "ml-auto "}text-xs text-slate-300 hover:text-red-500`}
            title="Widget'ı kaldır"
          >
            ✕
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {isReport ? (
          widget.reportId != null ? (
            <ReportView reportId={widget.reportId} extraFilters={extraFilters} />
          ) : (
            <div className="text-sm text-slate-400">Rapor seçilmemiş</div>
          )
        ) : (
          <>
            {error && <div className="text-sm text-red-500">Veri alınamadı</div>}
            {!data && !error && <div className="text-sm text-slate-400">Yükleniyor...</div>}
            {data && <WidgetBody type={widget.type} data={data} />}
          </>
        )}
      </div>
    </div>
  );
}

function WidgetBody({ type, data }: { type: WidgetType; data: QueryResult }) {
  if (data.rows.length === 0) {
    return <div className="text-sm text-slate-400">Bu seçim için veri yok</div>;
  }

  if (type === "kpi") {
    return (
      <div className="flex h-full flex-col items-start justify-center">
        <div
          className={`text-4xl font-bold ${
            data.grandTotal < 0 ? "text-red-600" : "text-slate-800"
          }`}
        >
          {nf.format(data.grandTotal)}
        </div>
        <div className="mt-1 text-xs text-slate-400">Toplam</div>
      </div>
    );
  }

  if (type === "table") {
    const rows = data.rows.slice(0, 12);
    const cols = data.cols.slice(0, 6);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 text-left"></th>
              {cols.map((c) => (
                <th key={c.code} className="py-1 text-right">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-600">
            {rows.map((r) => (
              <tr key={r.code} className={r.isLeaf ? "" : "font-semibold"}>
                <td className="py-1" style={{ paddingLeft: r.depth * 12 }}>
                  {r.name}
                </td>
                {cols.map((c) => (
                  <td key={c.code} className="py-1 text-right tabular-nums">
                    {r.cells[c.code] != null ? nf.format(r.cells[c.code]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const series = topSeries(data);

  if (type === "pie") {
    const pieData = series.map((s) => ({ name: s.name, value: Math.abs(s.total) }));
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="#ffffff"
            strokeWidth={2}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => nf.format(Number(v))} />
          <Legend
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: "#52514e" }}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const chartData = toChartData(data, series);
  const common = (
    <>
      <CartesianGrid stroke={GRIDLINE} strokeWidth={1} vertical={false} />
      <XAxis
        dataKey="name"
        tick={{ fontSize: 10, fill: INK_MUTED }}
        stroke={GRIDLINE}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 10, fill: INK_MUTED }}
        stroke="transparent"
        tickLine={false}
        tickFormatter={(v: number) => nfCompact.format(v)}
        width={52}
      />
      <Tooltip formatter={(v) => nf.format(Number(v))} />
      {series.length > 1 && (
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: "#52514e" }} />
      )}
    </>
  );

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData}>
          {common}
          {series.map((s, i) => (
            <Line
              key={s.code}
              type="monotone"
              dataKey={s.name}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} barGap={2} barCategoryGap="20%">
        {common}
        {series.map((s, i) => (
          <Bar
            key={s.code}
            dataKey={s.name}
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
