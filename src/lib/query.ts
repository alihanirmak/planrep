import { sqlite } from "./db";
import { getModelDims, withDescendants, type Member } from "./model";
import { allowedSets, restrictCodes } from "./access";
import type { QueryResult, QueryRow } from "./report-types";

export function runQuery(
  modelId: number,
  rowDim: string,
  colDim: string,
  filters: Record<string, string[]>,
  userId?: number
): QueryResult | { error: string } {
  const dims = getModelDims(modelId);
  const rowD = dims.find((d) => d.code === rowDim);
  const colD = dims.find((d) => d.code === colDim);
  if (!rowD || !colD || rowDim === colDim) return { error: "invalid_dims" };

  const access = userId != null ? allowedSets(userId, dims) : new Map<string, Set<string>>();
  const where: string[] = ["model_id = ?"];
  const params: unknown[] = [modelId];
  for (const d of dims) {
    const sel = filters[d.code];
    const requested =
      sel && sel.length > 0 ? withDescendants(d.members, sel) : undefined;
    const codes = restrictCodes(requested, access.get(d.code));
    if (codes) {
      if (codes.length === 0) {
        return { rows: [], cols: [], colTotals: {}, grandTotal: 0 };
      }
      where.push(`d${d.slot} IN (${codes.map(() => "?").join(",")})`);
      params.push(...codes);
    }
  }

  const sql = `SELECT d${rowD.slot} AS r, d${colD.slot} AS c, SUM(value) AS v
               FROM facts WHERE ${where.join(" AND ")} GROUP BY r, c`;
  const raw = sqlite.prepare(sql).all(...params) as Array<{
    r: string;
    c: string;
    v: number;
  }>;

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
  walk(children.get(null) ?? [], 0);

  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const m of children.get(null) ?? []) {
    const cells = cellsOf(m);
    for (const [c, v] of Object.entries(cells)) {
      colTotals[c] = (colTotals[c] ?? 0) + v;
      grandTotal += v;
    }
  }

  return { rows, cols, colTotals, grandTotal };
}
