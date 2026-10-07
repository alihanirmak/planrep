import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-model-measures-${process.pid}-${Date.now()}.db`
);

let mm: typeof import("./model-measures");
let sqlite: typeof import("./db")["sqlite"];
let modelId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  mm = await import("./model-measures");
  const db = await import("./db");
  sqlite = db.sqlite;

  modelId = Number(
    sqlite
      .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
      .run("MMTEST", "Model Measures Test", new Date().toISOString()).lastInsertRowid
  );
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("valueColumnForSlot / auditColumnsForSlot", () => {
  it("slot 1 mevcut 'value'/'old_value'/'new_value' kolonlarina esler", () => {
    expect(mm.valueColumnForSlot(1)).toBe("value");
    expect(mm.auditColumnsForSlot(1)).toEqual({ old: "old_value", new: "new_value" });
  });

  it("slot >1 value{slot}/old_value{slot}/new_value{slot} kolonlarina esler", () => {
    expect(mm.valueColumnForSlot(3)).toBe("value3");
    expect(mm.auditColumnsForSlot(5)).toEqual({ old: "old_value5", new: "new_value5" });
  });
});

describe("listEffectiveMeasures — geriye uyumluluk", () => {
  it("hic measure tanimlanmamis modelde sanal varsayilan tekil olcuyu doner", () => {
    const effective = mm.listEffectiveMeasures(modelId);
    expect(effective).toEqual([{ id: 0, modelId, code: "VALUE", name: "Değer", slot: 1 }]);
  });

  it("getModelMeasures (gercek DB satirlari) bos doner", () => {
    expect(mm.getModelMeasures(modelId)).toEqual([]);
  });
});

describe("createModelMeasure / getModelMeasures / listEffectiveMeasures", () => {
  let multiModelId: number;

  beforeAll(() => {
    multiModelId = Number(
      sqlite
        .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
        .run("MMMULTI", "Multi Measure Model", new Date().toISOString()).lastInsertRowid
    );
  });

  it("ilk olcu slot 1'i alir", () => {
    const m = mm.createModelMeasure({ modelId: multiModelId, code: "AMOUNT", name: "Tutar" });
    expect(m.slot).toBe(1);
    expect(m.code).toBe("AMOUNT");
  });

  it("ikinci/ucuncu olcu sirayla sonraki bos slotlari alir", () => {
    const qty = mm.createModelMeasure({ modelId: multiModelId, code: "QTY", name: "Miktar" });
    const price = mm.createModelMeasure({ modelId: multiModelId, code: "PRICE", name: "Birim Fiyat" });
    expect(qty.slot).toBe(2);
    expect(price.slot).toBe(3);
  });

  it("gercek olculer tanimlandiktan sonra listEffectiveMeasures bunlari doner (sanal degil)", () => {
    const effective = mm.listEffectiveMeasures(multiModelId);
    expect(effective.map((m) => m.code)).toEqual(["AMOUNT", "QTY", "PRICE"]);
    expect(effective.every((m) => m.id > 0)).toBe(true);
  });

  it("MAX_MODEL_MEASURES asilirsa MeasureLimitError firlatir", () => {
    for (let i = 4; i <= 8; i++) {
      mm.createModelMeasure({ modelId: multiModelId, code: `M${i}`, name: `Measure ${i}` });
    }
    expect(() => mm.createModelMeasure({ modelId: multiModelId, code: "OVERFLOW", name: "Overflow" })).toThrow(
      mm.MeasureLimitError
    );
  });

  it("updateMeasure sadece name degistirir", () => {
    const measures = mm.getModelMeasures(multiModelId);
    const amount = measures.find((m) => m.code === "AMOUNT")!;
    const updated = mm.updateMeasure(amount.id, { name: "Güncellenmiş Tutar" });
    expect(updated?.name).toBe("Güncellenmiş Tutar");
    expect(updated?.code).toBe("AMOUNT"); // degismedi
  });

  it("deleteModelMeasure kullanilmayan olcuyu siler", () => {
    const measures = mm.getModelMeasures(multiModelId);
    const m8 = measures.find((m) => m.code === "M8")!;
    mm.deleteModelMeasure(m8.id);
    expect(mm.getMeasure(m8.id)).toBeNull();
  });

  it("KRITIK: slot 1'deki olcu baska olculer varken silinemez (NOT NULL ihlalini onler)", () => {
    const measures = mm.getModelMeasures(multiModelId);
    const amount = measures.find((m) => m.code === "AMOUNT")!;
    expect(amount.slot).toBe(1);
    expect(() => mm.deleteModelMeasure(amount.id)).toThrow(mm.PrimaryMeasureInUseError);
    expect(mm.getMeasure(amount.id)).not.toBeNull();
  });

  it("business_rules.measure_code tarafindan kullanilan olcu silinemez", () => {
    const measures = mm.getModelMeasures(multiModelId);
    const qty = measures.find((m) => m.code === "QTY")!;
    sqlite
      .prepare(
        `INSERT INTO business_rules
           (tenant_id, model_id, name, scope_filters, op, value, measure_code, severity, active, created_at, updated_at)
         VALUES (1,?,?,?,?,?,?,?,1,?,?)`
      )
      .run(multiModelId, "QTY kurali", "{}", ">", 0, "QTY", "warn", new Date().toISOString(), new Date().toISOString());
    expect(() => mm.deleteModelMeasure(qty.id)).toThrow(mm.MeasureInUseError);
    expect(mm.getMeasure(qty.id)).not.toBeNull();
  });

  it("slot 1 TEK olcu ise silinebilir, sonrasinda sanal varsayilana doner", () => {
    const soloModelId = Number(
      sqlite
        .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
        .run("MMSOLO", "Solo Measure Model", new Date().toISOString()).lastInsertRowid
    );
    const solo = mm.createModelMeasure({ modelId: soloModelId, code: "ONLY", name: "Tek Ölçü" });
    mm.deleteModelMeasure(solo.id);
    expect(mm.getModelMeasures(soloModelId)).toEqual([]);
    expect(mm.listEffectiveMeasures(soloModelId)).toEqual([
      { id: 0, modelId: soloModelId, code: "VALUE", name: "Değer", slot: 1 },
    ]);
  });
});
