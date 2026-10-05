"use client";

import type { PivotView, PivotViewRow } from "@/lib/pivot";
import { PIVOT_SEP } from "@/lib/pivot";
import {
  computeCalcCells,
  styleFor,
  type CalcColumn,
  type CondRule,
} from "@/lib/report-types";

export const STYLE_CLASS: Record<string, string> = {
  "red-text": "text-red-600",
  "green-text": "text-green-700",
  "red-bg": "bg-red-100 text-red-800",
  "green-bg": "bg-green-100 text-green-800",
  "yellow-bg": "bg-yellow-100 text-yellow-800",
};

export type Transform = (
  v: number | undefined,
  colKey: string,
  rowTotal: number
) => number | null;

export default function PivotGrid({
  view,
  rowHeader,
  calcRows,
  calcColumns,
  condRules,
  subtotals,
  transform,
  format,
  sortKey,
  sortDir,
  onSort,
  onToggle,
  onCellClick,
  commentCells,
}: {
  view: PivotView;
  rowHeader: string;
  calcRows: PivotViewRow[];
  calcColumns: CalcColumn[];
  condRules: CondRule[];
  subtotals: boolean;
  transform: Transform;
  format: (v: number | null) => string;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  onToggle: (id: string) => void;
  onCellClick?: (row: PivotViewRow, colKey: string | null) => void;
  commentCells?: Set<string>;
}) {
  const twoLevel = view.columns.some((c) => c.labels.length > 1);
  const sortIcon = (key: string) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  function renderValueCell(
    row: PivotViewRow,
    colKey: string | null,
    raw: number | undefined,
    extraClass: string
  ) {
    const showValues = subtotals || !row.hasChildren || !row.expanded || row.isCalc;
    const t = colKey == null ? (showValues ? transform(raw, "TOPLAM", row.total) : null)
      : showValues ? transform(raw, colKey, row.total) : null;
    const st = showValues
      ? styleFor(condRules, colKey ?? "TOPLAM", raw)
      : null;
    const cellKey = `${row.id}|${colKey ?? "TOPLAM"}`;
    const hasComment = commentCells?.has(cellKey);
    return (
      <td
        key={colKey ?? "__total"}
        onClick={() => showValues && onCellClick?.(row, colKey)}
        className={`relative whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${extraClass} ${
          st ? STYLE_CLASS[st] : t != null && t < 0 ? "text-red-600" : ""
        } ${onCellClick && showValues ? "cursor-pointer hover:outline hover:outline-1 hover:outline-blue-300" : ""}`}
      >
        {t != null ? format(t) : showValues ? "—" : ""}
        {hasComment && (
          <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
        )}
      </td>
    );
  }

  function renderRow(row: PivotViewRow) {
    const calc = computeCalcCells({ cells: row.cells, total: row.total }, calcColumns);
    const boldCls = row.isCalc
      ? "bg-violet-50 font-semibold text-violet-900"
      : !row.hasChildren
        ? ""
        : "bg-slate-50/60 font-semibold";
    return (
      <tr key={row.id} className={boldCls}>
        <td
          className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-3 py-1.5"
          style={{ paddingLeft: 8 + row.depth * 18 }}
        >
          {row.hasChildren && !row.isCalc ? (
            <button
              onClick={() => onToggle(row.id)}
              className="mr-1 inline-block w-4 text-slate-400 hover:text-slate-700"
            >
              {row.expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="mr-1 inline-block w-4" />
          )}
          {row.isCalc && <span className="mr-1 text-violet-400">ƒ</span>}
          {row.name}
        </td>
        {view.columns.map((c) => renderValueCell(row, c.key, row.cells[c.key], ""))}
        {renderValueCell(row, null, row.total, "font-semibold")}
        {calcColumns.map((cc) => {
          const v = calc[cc.id];
          const st = styleFor(condRules, `calc:${cc.id}`, v ?? undefined);
          return (
            <td
              key={cc.id}
              className={`whitespace-nowrap bg-blue-50/40 px-3 py-1.5 text-right tabular-nums ${
                st ? STYLE_CLASS[st] : v != null && v < 0 ? "text-red-600" : ""
              }`}
            >
              {v != null ? format(v) : "—"}
            </td>
          );
        })}
      </tr>
    );
  }

  const totalCalc = computeCalcCells(
    { cells: view.colTotals, total: view.grandTotal },
    calcColumns
  );

  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm print:shadow-none">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          {twoLevel && (
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2"></th>
              {view.columns.map((c) => (
                <th key={c.key} className="px-3 py-1 text-right font-medium text-slate-400">
                  {c.labels[0]}
                </th>
              ))}
              <th></th>
              {calcColumns.map((cc) => (
                <th key={cc.id}></th>
              ))}
            </tr>
          )}
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left">
              <button onClick={() => onSort("__name")} className="hover:text-slate-800">
                {rowHeader}
                {sortIcon("__name")}
              </button>
            </th>
            {view.columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right">
                <button onClick={() => onSort(c.key)} className="hover:text-slate-800">
                  {c.labels[twoLevel ? 1 : 0] ?? c.labels[0]}
                  {sortIcon(c.key)}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 text-right">
              <button onClick={() => onSort("__total")} className="hover:text-slate-800">
                Toplam{sortIcon("__total")}
              </button>
            </th>
            {calcColumns.map((cc) => (
              <th key={cc.id} className="bg-blue-50 px-3 py-2 text-right text-blue-700">
                ƒ {cc.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700 [&>tr]:bg-white">
          {view.rows.map(renderRow)}
          {calcRows.map(renderRow)}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-800">
            <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2">Genel Toplam</td>
            {view.columns.map((c) => {
              const t = transform(view.colTotals[c.key], c.key, view.grandTotal);
              return (
                <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {t != null ? format(t) : "—"}
                </td>
              );
            })}
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
              {format(transform(view.grandTotal, "TOPLAM", view.grandTotal))}
            </td>
            {calcColumns.map((cc) => (
              <td
                key={cc.id}
                className="whitespace-nowrap bg-blue-100/50 px-3 py-2 text-right tabular-nums"
              >
                {totalCalc[cc.id] != null ? format(totalCalc[cc.id]!) : "—"}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export { PIVOT_SEP };
