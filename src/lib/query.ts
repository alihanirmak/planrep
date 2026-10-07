import { sqlite } from "./db";
import { getModelDims, rootMembers, type Member } from "./model";
import { allowedSets } from "./access";
import { buildFactWhereVariants, sumGroupedRows, MAX_AGGREGATE_RESULT_ROWS } from "./fact-filters";
import type { QueryResult, QueryRow } from "./report-types";
import { listEffectiveMeasures, valueColumnForSlot } from "./model-measures";

// measureCode: coklu-olcu modellerinde HANGI olcunun aggregate edilecegini
// belirtir (verilmezse birincil/slot 1 olcu — geriye uyumlu, tek-olcu
// modellerde zaten tek secenek budur). Gecersiz/bulunamayan bir kod
// verilirse sessizce birincil olcuye duser.
export function runQuery(
  modelId: number,
  rowDim: string,
  colDim: string,
  filters: Record<string, string[]>,
  userId?: number,
  pagination?: { page: number; pageSize: number },
  measureCode?: string
): QueryResult | { error: string } {
  const dims = getModelDims(modelId);
  const rowD = dims.find((d) => d.code === rowDim);
  const colD = dims.find((d) => d.code === colDim);
  if (!rowD || !colD || rowDim === colDim) return { error: "invalid_dims" };

  const measures = listEffectiveMeasures(modelId);
  const measure =
    (measureCode ? measures.find((m) => m.code === measureCode) : undefined) ??
    measures.find((m) => m.slot === 1) ??
    measures[0];
  const valueCol = valueColumnForSlot(measure.slot);

  // Sayfalama: rowDim'in kok uyeleri sayfalanir, her sayfaya secilen kok
  // uyelerin TUM alt agaci (withDescendants, buildFactWhereVariants icinde)
  // dahil edilir — boylece sayfadaki her satirin toplami her zaman dogru
  // hesaplanir (sadece hangi kok uyelerin gosterildigi sinirlanir). colTotals/
  // grandTotal da SADECE o sayfanin kok uyelerini kapsar (bkz. QueryResult.pagination).
  const allRoots = rootMembers(rowD.members);
  const pageRoots = pagination
    ? allRoots.slice(pagination.page * pagination.pageSize, (pagination.page + 1) * pagination.pageSize)
    : allRoots;
  let effectiveFilters = filters;
  if (pagination) {
    const pageRootCodes = pageRoots.map((m) => m.code);
    const existing = filters[rowDim];
    const rowCodes =
      existing && existing.length > 0 ? pageRootCodes.filter((c) => existing.includes(c)) : pageRootCodes;
    effectiveFilters = { ...filters, [rowDim]: rowCodes };
  }

  const access = userId != null ? allowedSets(userId, dims) : new Map<string, Set<string>>();
  const { variants, empty } = buildFactWhereVariants(modelId, dims, effectiveFilters, access);
  if (empty) {
    return {
      rows: [],
      cols: [],
      colTotals: {},
      grandTotal: 0,
      ...(pagination
        ? { pagination: { page: pagination.page, pageSize: pagination.pageSize, totalRoots: allRoots.length } }
        : {}),
    };
  }

  const partials = variants.map(
    (v) =>
      sqlite
        .prepare(
          `SELECT d${rowD.slot} AS r, d${colD.slot} AS c, SUM(${valueCol}) AS v
           FROM facts WHERE ${v.sql} GROUP BY r, c`
        )
        .all(...v.params) as Array<Record<string, unknown>>
  );
  const raw = sumGroupedRows(partials, ["r", "c"]) as Array<{
    r: string;
    c: string;
    v: number;
  }>;
  if (raw.length > MAX_AGGREGATE_RESULT_ROWS) {
    return { error: "result_too_large" };
  }

  // Yaprak toplamlarindan hiyerarsik rollup
  const leafSums = new Map<string, Map<string, number>>();
  const colSet = new Set<string>();
  for (const row of raw) {
    if (!leafSums.has(row.r)) leafSums.set(row.r, new Map());
    leafSums.get(row.r)!.set(row.c, (leafSums.get(row.r)!.get(row.c) ?? 0) + row.v);
    colSet.add(row.c);
  }

  const byId = new Map<number, Member>(rowD.members.map((m) => [m.id, m]));
  const children = new Map<number | null, Member[]>();
  for (const m of rowD.members) {
    const key = m.parentId != null && byId.has(m.parentId) ? m.parentId : null;
    const arr = children.get(key) ?? [];
    arr.push(m);
    children.set(key, arr);
  }

  const memo = new Map<number, Record<string, number>>();
  function cellsOf(m: Member): Record<string, number> {
    if (memo.has(m.id)) return memo.get(m.id)!;
    const acc: Record<string, number> = {};
    const own = leafSums.get(m.code);
    if (own) for (const [c, v] of own) acc[c] = (acc[c] ?? 0) + v;
    for (const ch of children.get(m.id) ?? []) {
      const sub = cellsOf(ch);
      for (const [c, v] of Object.entries(sub)) acc[c] = (acc[c] ?? 0) + v;
    }
    memo.set(m.id, acc);
    return acc;
  }

  const colOrder = new Map(colD.members.map((m, i) => [m.code, m.orderIdx * 100000 + i]));
  const colNames = new Map(colD.members.map((m) => [m.code, m.name]));
  const cols = [...colSet]
    .sort((a, b) => (colOrder.get(a) ?? 1e12) - (colOrder.get(b) ?? 1e12))
    .map((code) => ({ code, name: colNames.get(code) ?? code }));

  const rows: QueryRow[] = [];
  function walk(list: Member[], depth: number) {
    for (const m of list) {
      const cells = cellsOf(m);
      const kids = children.get(m.id) ?? [];
      const total = Object.values(cells).reduce((a, b) => a + b, 0);
      if (Object.keys(cells).length > 0) {
        rows.push({ code: m.code, name: m.name, depth, isLeaf: kids.length === 0, cells, total });
      }
      walk(kids, depth + 1);
    }
  }
  walk(pageRoots, 0);

  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const m of pageRoots) {
    const cells = cellsOf(m);
    for (const [c, v] of Object.entries(cells)) {
      colTotals[c] = (colTotals[c] ?? 0) + v;
      grandTotal += v;
    }
  }

  return {
    rows,
    cols,
    colTotals,
    grandTotal,
    ...(pagination
      ? { pagination: { page: pagination.page, pageSize: pagination.pageSize, totalRoots: allRoots.length } }
      : {}),
  };
}
