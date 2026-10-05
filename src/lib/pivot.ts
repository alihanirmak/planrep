// Istemci tarafi pivot motoru: coklu satir/sutun boyutu, hiyerarsi ac/kapa,
// siralama, top-N, sifir gizleme. Sunucu yaprak seviyesinde gruplanmis
// "tuple"lari dondurur; sunum katmani burada kurulur.

export type Member = {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  orderIdx: number;
};

export type PivotDim = { code: string; name: string; members: Member[] };

export type PivotTuple = { r: string[]; c: string[]; v: number };

export type PivotSort = { key: string; dir: "asc" | "desc" } | null; // key: colKey | "__total" | "__name"

export type PivotColumn = { key: string; labels: string[] };

export type PivotViewRow = {
  id: string;
  path: string[]; // her satir boyutu icin ulasilan uye kodu
  name: string;
  depth: number;
  dimIndex: number; // hangi satir boyutunda
  hasChildren: boolean;
  expanded: boolean;
  isCalc: boolean;
  cells: Record<string, number>;
  total: number;
};

export type PivotView = {
  columns: PivotColumn[];
  rows: PivotViewRow[];
  colTotals: Record<string, number>;
  grandTotal: number;
};

const SEP = "¦";

type DimIndexData = {
  byCode: Map<string, Member>;
  children: Map<number | null, Member[]>;
  desc: Map<string, Set<string>>; // uye -> kendisi + tum altlari (kod)
};

function indexDim(dim: PivotDim): DimIndexData {
  const byId = new Map(dim.members.map((m) => [m.id, m]));
  const byCode = new Map(dim.members.map((m) => [m.code, m]));
  const children = new Map<number | null, Member[]>();
  for (const m of dim.members) {
    const key = m.parentId != null && byId.has(m.parentId) ? m.parentId : null;
    const arr = children.get(key) ?? [];
    arr.push(m);
    children.set(key, arr);
  }
  for (const arr of children.values()) {
    arr.sort((a, b) => a.orderIdx - b.orderIdx || a.id - b.id);
  }
  const desc = new Map<string, Set<string>>();
  function collect(m: Member): Set<string> {
    const cached = desc.get(m.code);
    if (cached) return cached;
    const set = new Set<string>([m.code]);
    for (const ch of children.get(m.id) ?? []) {
      for (const c of collect(ch)) set.add(c);
    }
    desc.set(m.code, set);
    return set;
  }
  for (const m of dim.members) collect(m);
  return { byCode, children, desc };
}

export type PivotEngine = {
  view: (opts: {
    expanded: Set<string>;
    hideZero: boolean;
    sort: PivotSort;
    topN: number | null;
  }) => PivotView;
  cellsForMember: (dim0Code: string) => { cells: Record<string, number>; total: number };
  columns: PivotColumn[];
  colTotals: Record<string, number>;
  grandTotal: number;
  defaultExpanded: () => Set<string>;
};

export function createPivotEngine(
  rowDims: PivotDim[],
  colDims: PivotDim[],
  tuples: PivotTuple[]
): PivotEngine {
  const rowIdx = rowDims.map(indexDim);
  const colIdx = colDims.map(indexDim);

  // Kolonlar: tuple'larda gorulen kombinasyonlar, uye sirasina gore
  const colKeyMap = new Map<string, string[]>();
  for (const t of tuples) {
    const key = t.c.join(SEP);
    if (!colKeyMap.has(key)) colKeyMap.set(key, t.c);
  }
  function colSortVal(codes: string[]): number[] {
    return codes.map((code, i) => {
      const m = colIdx[i]?.byCode.get(code);
      return m ? m.orderIdx * 100000 + m.id : 1e12;
    });
  }
  const columns: PivotColumn[] = [...colKeyMap.entries()]
    .sort((a, b) => {
      const va = colSortVal(a[1]);
      const vb = colSortVal(b[1]);
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const d = (va[i] ?? 0) - (vb[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    })
    .map(([key, codes]) => ({
      key,
      labels: codes.map((code, i) => colIdx[i]?.byCode.get(code)?.name ?? code),
    }));

  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const t of tuples) {
    const key = t.c.join(SEP);
    colTotals[key] = (colTotals[key] ?? 0) + t.v;
    grandTotal += t.v;
  }

  // Hucre hesaplama (memoize)
  const cellMemo = new Map<string, Record<string, number>>();
  function cellsFor(path: string[]): Record<string, number> {
    const id = path.join(SEP);
    const cached = cellMemo.get(id);
    if (cached) return cached;
    const sets = path.map((code, i) => rowIdx[i].desc.get(code) ?? new Set([code]));
    const acc: Record<string, number> = {};
    for (const t of tuples) {
      let ok = true;
      for (let i = 0; i < sets.length; i++) {
        if (!sets[i].has(t.r[i])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const key = t.c.join(SEP);
      acc[key] = (acc[key] ?? 0) + t.v;
    }
    cellMemo.set(id, acc);
    return acc;
  }

  function totalOf(cells: Record<string, number>): number {
    return Object.values(cells).reduce((a, b) => a + b, 0);
  }

  type Node = {
    id: string;
    path: string[];
    member: Member;
    dimIndex: number;
    cells: Record<string, number>;
    total: number;
    children: Node[];
  };

  const nodeMemo = new Map<string, Node | null>();
  function buildNode(path: string[], member: Member, dimIndex: number): Node | null {
    const id = path.join(SEP);
    if (nodeMemo.has(id)) return nodeMemo.get(id)!;
    const cells = cellsFor(path);
    if (Object.keys(cells).length === 0) {
      nodeMemo.set(id, null);
      return null;
    }
    const node: Node = {
      id,
      path,
      member,
      dimIndex,
      cells,
      total: totalOf(cells),
      children: [],
    };
    // Once ayni boyutta hiyerarsi cocuklari; yoksa sonraki boyutun kokleri
    const hier = rowIdx[dimIndex].children.get(member.id) ?? [];
    if (hier.length > 0) {
      node.children = hier
        .map((ch) => buildNode([...path.slice(0, dimIndex), ch.code], ch, dimIndex))
        .filter((n): n is Node => n != null);
    } else if (dimIndex + 1 < rowDims.length) {
      const roots = rowIdx[dimIndex + 1].children.get(null) ?? [];
      node.children = roots
        .map((ch) => buildNode([...path, ch.code], ch, dimIndex + 1))
        .filter((n): n is Node => n != null);
    }
    nodeMemo.set(id, node);
    return node;
  }

  function rootNodes(): Node[] {
    const roots = rowIdx[0]?.children.get(null) ?? [];
    return roots
      .map((m) => buildNode([m.code], m, 0))
      .filter((n): n is Node => n != null);
  }

  function view(opts: {
    expanded: Set<string>;
    hideZero: boolean;
    sort: PivotSort;
    topN: number | null;
  }): PivotView {
    const { expanded, hideZero, sort, topN } = opts;

    function sortNodes(nodes: Node[]): Node[] {
      if (!sort) return nodes;
      const dir = sort.dir === "asc" ? 1 : -1;
      return [...nodes].sort((a, b) => {
        if (sort.key === "__name") return a.member.name.localeCompare(b.member.name, "tr") * dir;
        const va = sort.key === "__total" ? a.total : a.cells[sort.key] ?? 0;
        const vb = sort.key === "__total" ? b.total : b.cells[sort.key] ?? 0;
        return (va - vb) * dir;
      });
    }

    function isZero(n: Node): boolean {
      return Object.values(n.cells).every((v) => v === 0);
    }

    const rows: PivotViewRow[] = [];
    function emit(nodes: Node[], depth: number, isTop: boolean) {
      let list = sortNodes(nodes);
      if (hideZero) list = list.filter((n) => !isZero(n));
      if (isTop && topN != null && topN > 0) {
        if (!sort) list = [...list].sort((a, b) => b.total - a.total);
        list = list.slice(0, topN);
      }
      for (const n of list) {
        const isOpen = expanded.has(n.id);
        rows.push({
          id: n.id,
          path: n.path,
          name: n.member.name,
          depth,
          dimIndex: n.dimIndex,
          hasChildren: n.children.length > 0,
          expanded: isOpen,
          isCalc: false,
          cells: n.cells,
          total: n.total,
        });
        if (isOpen && n.children.length > 0) emit(n.children, depth + 1, false);
      }
    }
    emit(rootNodes(), 0, true);

    return { columns, rows, colTotals, grandTotal };
  }

  function defaultExpanded(): Set<string> {
    // Ilk boyutun koklerini acik baslat
    const set = new Set<string>();
    for (const n of rootNodes()) {
      if (n.children.length > 0) set.add(n.id);
    }
    return set;
  }

  function cellsForMember(dim0Code: string) {
    const cells = cellsFor([dim0Code]);
    return { cells, total: totalOf(cells) };
  }

  return { view, cellsForMember, columns, colTotals, grandTotal, defaultExpanded };
}

export const PIVOT_SEP = SEP;
