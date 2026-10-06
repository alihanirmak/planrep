import { describe, it, expect } from "vitest";
import { createPivotEngine, type Member, type PivotDim, type PivotTuple } from "./pivot";

function member(id: number, code: string, name: string, parentId: number | null, orderIdx = 0): Member {
  return { id, code, name, parentId, orderIdx };
}

// COSTCENTER: CC_ALL -> CC100, CC200
const ccAll = member(1, "CC_ALL", "Tüm Masraf Yerleri", null, 0);
const cc100 = member(2, "CC100", "Satış", 1, 1);
const cc200 = member(3, "CC200", "Pazarlama", 1, 2);
const costCenterDim: PivotDim = {
  code: "COSTCENTER",
  name: "Masraf Yeri",
  members: [ccAll, cc100, cc200],
};

// VERSION: duz liste (hiyerarsisiz)
const budget = member(10, "BUDGET", "Bütçe", null, 0);
const actual = member(11, "ACTUAL", "Gerçekleşen", null, 1);
const versionDim: PivotDim = {
  code: "VERSION",
  name: "Versiyon",
  members: [budget, actual],
};

const tuples: PivotTuple[] = [
  { r: ["CC100"], c: ["BUDGET"], v: 100 },
  { r: ["CC100"], c: ["ACTUAL"], v: 90 },
  { r: ["CC200"], c: ["BUDGET"], v: 50 },
  { r: ["CC200"], c: ["ACTUAL"], v: 0 },
];

describe("createPivotEngine", () => {
  it("yaprak hucreleri dogru rapor eder", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    const cc100Cells = engine.cellsForMember("CC100");
    expect(cc100Cells.cells).toEqual({ BUDGET: 100, ACTUAL: 90 });
    expect(cc100Cells.total).toBe(190);
  });

  it("ust uye (parent) alt uyelerin toplamini rollup eder", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    const allCells = engine.cellsForMember("CC_ALL");
    expect(allCells.cells).toEqual({ BUDGET: 150, ACTUAL: 90 });
    expect(allCells.total).toBe(240);
  });

  it("grandTotal ve colTotals tum tuple'lari toplar", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    expect(engine.grandTotal).toBe(240);
    expect(engine.colTotals).toEqual({ BUDGET: 150, ACTUAL: 90 });
  });

  it("view() kapali durumda sadece kok satirlari gosterir", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    const view = engine.view({ expanded: new Set(), hideZero: false, sort: null, topN: null });
    expect(view.rows.map((r) => r.id)).toEqual(["CC_ALL"]);
    expect(view.rows[0].hasChildren).toBe(true);
    expect(view.rows[0].expanded).toBe(false);
  });

  it("view() acik (expanded) durumda alt satirlari da gosterir", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    const view = engine.view({ expanded: new Set(["CC_ALL"]), hideZero: false, sort: null, topN: null });
    expect(view.rows.map((r) => r.id)).toEqual(["CC_ALL", "CC100", "CC200"]);
    expect(view.rows[1].depth).toBe(1);
  });

  it("hideZero=true sifir satirlari filtreler", () => {
    const zeroTuples: PivotTuple[] = [
      { r: ["CC100"], c: ["BUDGET"], v: 100 },
      { r: ["CC200"], c: ["BUDGET"], v: 0 },
    ];
    const engine = createPivotEngine([costCenterDim], [versionDim], zeroTuples);
    const view = engine.view({ expanded: new Set(["CC_ALL"]), hideZero: true, sort: null, topN: null });
    expect(view.rows.map((r) => r.id)).toEqual(["CC_ALL", "CC100"]);
  });

  it("sort: __total alanina gore siralar", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    const view = engine.view({
      expanded: new Set(["CC_ALL"]),
      hideZero: false,
      sort: { key: "__total", dir: "asc" },
      topN: null,
    });
    const childRows = view.rows.filter((r) => r.depth === 1);
    expect(childRows.map((r) => r.id)).toEqual(["CC200", "CC100"]);
  });

  it("defaultExpanded() cocugu olan kok uyeleri acik baslatir", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    expect(engine.defaultExpanded()).toEqual(new Set(["CC_ALL"]));
  });

  it("columns tuple'larda gorulen kolon kombinasyonlarini uye sirasina gore dondurur", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    expect(engine.columns.map((c) => c.key)).toEqual(["BUDGET", "ACTUAL"]);
    expect(engine.columns.map((c) => c.labels)).toEqual([["Bütçe"], ["Gerçekleşen"]]);
  });

  it("ilgisiz uye icin bos hucre doner", () => {
    const engine = createPivotEngine([costCenterDim], [versionDim], tuples);
    expect(engine.cellsForMember("UNKNOWN")).toEqual({ cells: {}, total: 0 });
  });
});
