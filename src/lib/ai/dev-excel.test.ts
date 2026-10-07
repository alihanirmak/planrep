import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseExcelToDevPlan } from "./dev-excel";
import type { ModelInfo } from "../model";

async function buildWorkbook(headers: string[], rows: Array<Array<string | number>>) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Veri");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}

describe("parseExcelToDevPlan — yeni model senaryosu", () => {
  it("metin kolonlarini boyut, sayisal kolonlari olcu olarak siniflandirip plan uretir", async () => {
    const buf = await buildWorkbook(
      ["BOLGE", "ZAMAN", "TUTAR", "MIKTAR"],
      [
        ["EMEA", "2026-01", 100, 5],
        ["APAC", "2026-01", 200, 10],
        ["EMEA", "2026-02", 150, 7],
      ]
    );
    const result = await parseExcelToDevPlan(buf, { modelNameHint: "Test Model", existingModels: [] });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const types = result.plan.actions.map((a) => a.type);
    expect(types.filter((t) => t === "create_dimension")).toHaveLength(2);
    expect(types.filter((t) => t === "create_model")).toHaveLength(1);
    // Ilk olcu (TUTAR) birincil (slot 1) kabul edilir, create_measure GEREKMEZ;
    // ikinci olcu (MIKTAR) icin create_measure gerekir.
    expect(types.filter((t) => t === "create_measure")).toHaveLength(1);
    expect(types.filter((t) => t === "upload_facts")).toHaveLength(1);

    const uploadAction = result.plan.actions.find((a) => a.type === "upload_facts");
    if (uploadAction?.type !== "upload_facts") throw new Error("beklenmeyen");
    expect(uploadAction.rows).toHaveLength(3);
    expect(uploadAction.rows[0].value).toBe(100);
  });

  it("basligi olmayan/bos dosya icin hata doner", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Boş");
    const buf = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
    const result = await parseExcelToDevPlan(buf, { existingModels: [] });
    expect("error" in result).toBe(true);
  });

  it("sadece boyut kolonu varsa (olcu yoksa) hata doner", async () => {
    const buf = await buildWorkbook(
      ["BOLGE", "URUN"],
      [
        ["EMEA", "P1"],
        ["APAC", "P2"],
      ]
    );
    const result = await parseExcelToDevPlan(buf, { existingModels: [] });
    expect(result).toEqual({ error: "no_measure_columns" });
  });
});

describe("parseExcelToDevPlan — mevcut modele veri ekleme senaryosu", () => {
  const existingModel: ModelInfo = {
    id: 42,
    code: "SALES",
    name: "Satış",
    description: null,
    dims: [
      { id: 1, code: "BOLGE", name: "Bölge", type: "standard", slot: 1, members: [] },
      { id: 2, code: "ZAMAN", name: "Zaman", type: "time", slot: 2, members: [] },
    ],
    measures: [{ id: 1, modelId: 42, code: "TUTAR", name: "Tutar", slot: 1 }],
  };

  it("basliklar mevcut boyut/olculerle eslesirse yeni boyut/model/olcu onerilmez, sadece veri yuklenir", async () => {
    const buf = await buildWorkbook(
      ["BOLGE", "ZAMAN", "TUTAR"],
      [["EMEA", "2026-01", 100]]
    );
    const result = await parseExcelToDevPlan(buf, { modelCodeHint: "SALES", existingModels: [existingModel] });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const types = result.plan.actions.map((a) => a.type);
    expect(types).toEqual(["upload_facts"]);
  });

  it("eslesmeyen bir basliklar yeni boyut olarak onerilir, eslesen degil", async () => {
    const buf = await buildWorkbook(
      ["BOLGE", "ZAMAN", "URUN", "TUTAR"],
      [["EMEA", "2026-01", "P1", 100]]
    );
    const result = await parseExcelToDevPlan(buf, { modelCodeHint: "SALES", existingModels: [existingModel] });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const dimActions = result.plan.actions.filter((a) => a.type === "create_dimension");
    expect(dimActions).toHaveLength(1);
    if (dimActions[0]?.type === "create_dimension") expect(dimActions[0].code).toBe("URUN");
  });
});
