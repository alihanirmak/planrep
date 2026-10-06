// Rapor tanimi ve paylasillan tipler — hem istemci hem sunucu (saf TS)
import { compileFormula } from "./formula";
import { withTimeOffsets } from "./time-offset";

export type CalcColumn = { id: string; name: string; formula: string };
export type CalcRow = { id: string; name: string; formula: string };

export type CondRule = {
  target: string; // "*" = tum deger hucreleri, kolon anahtari, "calc:<id>" veya "TOPLAM"
  op: "<" | ">" | "<=" | ">=" | "=";
  value: number;
  style: "red-text" | "green-text" | "red-bg" | "green-bg" | "yellow-bg";
};

export type ValueMode = "abs" | "pctRow" | "pctCol";

export type ReportOptions = {
  hideZero: boolean;
  subtotals: boolean;
  valueMode: ValueMode;
  scale: 1 | 1000 | 1000000;
  decimals: 0 | 1 | 2;
  topN: number | null;
  sort: { key: string; dir: "asc" | "desc" } | null;
};

export const DEFAULT_OPTIONS: ReportOptions = {
  hideZero: false,
  subtotals: true,
  valueMode: "abs",
  scale: 1,
  decimals: 0,
  topN: null,
  sort: null,
};

// v2 rapor tanimi: coklu satir/sutun boyutu, coklu filtre
export type ReportDefV2 = {
  version: 2;
  modelId: number;
  rows: string[];
  cols: string[];
  filters: Record<string, string[]>;
  calcColumns: CalcColumn[];
  calcRows: CalcRow[];
  condRules: CondRule[];
  options: ReportOptions;
};

// v1 (eski kayitli raporlar icin gecis)
export type ReportDefV1 = {
  modelId: number;
  rowDim: string;
  colDim: string;
  filters: Record<string, string[]>;
  calcColumns?: CalcColumn[];
  condRules?: CondRule[];
};

export function migrateDef(def: ReportDefV1 | ReportDefV2): ReportDefV2 {
  if ("version" in def && def.version === 2) return def;
  const v1 = def as ReportDefV1;
  return {
    version: 2,
    modelId: v1.modelId,
    rows: [v1.rowDim],
    cols: [v1.colDim],
    filters: v1.filters ?? {},
    calcColumns: v1.calcColumns ?? [],
    calcRows: [],
    condRules: v1.condRules ?? [],
    options: { ...DEFAULT_OPTIONS },
  };
}

// Eski tek boyutlu sorgu sonucu (dashboard widget'lari kullanir)
export type QueryRow = {
  code: string;
  name: string;
  depth: number;
  isLeaf: boolean;
  cells: Record<string, number>;
  total: number;
};

export type QueryResult = {
  rows: QueryRow[];
  cols: Array<{ code: string; name: string }>;
  colTotals: Record<string, number>;
  grandTotal: number;
  // Sadece page/pageSize istenirse doner: rowDim'in kok uyeleri sayfalanir
  // (her sayfadaki satirlarin alt-agac toplamlari her zaman dogrudur — bkz.
  // lib/model.ts rootMembers). colTotals/grandTotal SADECE o sayfanin
  // verisini yansitir (sayfalanmis gorunumun kendi ic toplami).
  pagination?: { page: number; pageSize: number; totalRoots: number };
};

export function computeCalcCells(
  row: { cells: Record<string, number>; total: number },
  calcColumns: CalcColumn[]
): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const cc of calcColumns) {
    try {
      const compiled = compileFormula(cc.formula);
      out[cc.id] = compiled.run(
        withTimeOffsets((ref) => (ref === "TOPLAM" || ref === "TOTAL" ? row.total : row.cells[ref]))
      );
    } catch {
      out[cc.id] = undefined;
    }
  }
  return out;
}

export function ruleMatches(rule: CondRule, v: number): boolean {
  switch (rule.op) {
    case "<":
      return v < rule.value;
    case ">":
      return v > rule.value;
    case "<=":
      return v <= rule.value;
    case ">=":
      return v >= rule.value;
    case "=":
      return v === rule.value;
  }
}

export function styleFor(
  rules: CondRule[],
  target: string,
  v: number | undefined
): CondRule["style"] | null {
  if (v == null) return null;
  let matched: CondRule["style"] | null = null;
  for (const r of rules) {
    if ((r.target === "*" || r.target === target) && ruleMatches(r, v)) {
      matched = r.style;
    }
  }
  return matched;
}

// Export ucu: istemcide olusturulan hazir tablo
export type ExportCell = { v: number | null; style: string | null };
export type ExportPayload = {
  name: string;
  rowHeader: string;
  headerRows: string[][]; // cok seviyeli kolon basliklari (calc kolonlar dahil son satirda)
  rows: Array<{ name: string; depth: number; bold: boolean; values: ExportCell[] }>;
  totals: ExportCell[];
  decimals: number;
};
