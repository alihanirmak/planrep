import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-fact-audit-${process.pid}-${Date.now()}.db`
);

let listFactAudit: typeof import("./fact-audit")["listFactAudit"];
let rollbackFactAudit: typeof import("./fact-audit")["rollbackFactAudit"];
let upsertFacts: typeof import("./facts-write")["upsertFacts"];
let getModelDims: typeof import("./model")["getModelDims"];
let sqlite: typeof import("./db")["sqlite"];

let modelId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  const factAudit = await import("./fact-audit");
  listFactAudit = factAudit.listFactAudit;
  rollbackFactAudit = factAudit.rollbackFactAudit;
  const factsWrite = await import("./facts-write");
  upsertFacts = factsWrite.upsertFacts;
  const model = await import("./model");
  getModelDims = model.getModelDims;
  const db = await import("./db");
  sqlite = db.sqlite;

  const now = new Date().toISOString();
  modelId = Number(
    sqlite
      .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
      .run("FATEST", "Fact Audit Test", now).lastInsertRowid
  );
  const d1 = Number(
    sqlite.prepare("INSERT INTO dimensions (code, name) VALUES (?,?)").run("FA_D1", "Dim1").lastInsertRowid
  );
  const d2 = Number(
    sqlite.prepare("INSERT INTO dimensions (code, name) VALUES (?,?)").run("FA_D2", "Dim2").lastInsertRowid
  );
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,1)")
    .run(modelId, d1);
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,2)")
    .run(modelId, d2);
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

function newUpload(): number {
  return Number(
    sqlite
      .prepare("INSERT INTO uploads (model_id, filename, user_id, created_at) VALUES (?,?,?,?)")
      .run(modelId, "test.csv", 1, new Date().toISOString()).lastInsertRowid
  );
}

describe("rollbackFactAudit", () => {
  it("oldValue tanimliyken degeri geri yazar ve YENI bir fact_audit kaydi doner", () => {
    const dims = getModelDims(modelId);
    const uploadId = newUpload();
    upsertFacts(modelId, dims, [{ coords: ["A1", "B1"], value: 10 }], uploadId, new Date().toISOString(), 1);

    const uploadId2 = newUpload();
    upsertFacts(modelId, dims, [{ coords: ["A1", "B1"], value: 20 }], uploadId2, new Date().toISOString(), 1);

    const history = listFactAudit(modelId, { coordsByDimCode: { FA_D1: "A1", FA_D2: "B1" } });
    const writeEntry = history.find((h) => h.oldValue === 10 && h.newValue === 20);
    expect(writeEntry).toBeDefined();

    const created = rollbackFactAudit(writeEntry!.id, 1);
    expect(created.oldValue).toBe(20);
    expect(created.newValue).toBe(10);
    expect(created.source).toBe("write");

    const row = sqlite
      .prepare("SELECT value FROM facts WHERE model_id=? AND d1=? AND d2=?")
      .get(modelId, "A1", "B1") as { value: number };
    expect(row.value).toBe(10);
  });

  it("geri almanin kendisi tekrar geri alinarak redo zinciri olusturulabilir", () => {
    const dims = getModelDims(modelId);
    const uploadId = newUpload();
    upsertFacts(modelId, dims, [{ coords: ["A2", "B2"], value: 5 }], uploadId, new Date().toISOString(), 1);
    const uploadId2 = newUpload();
    upsertFacts(modelId, dims, [{ coords: ["A2", "B2"], value: 50 }], uploadId2, new Date().toISOString(), 1);

    const history = listFactAudit(modelId, { coordsByDimCode: { FA_D1: "A2", FA_D2: "B2" } });
    const original = history.find((h) => h.oldValue === 5 && h.newValue === 50)!;

    const undone = rollbackFactAudit(original.id, 1); // deger 50 -> 5
    expect(undone.newValue).toBe(5);

    const redone = rollbackFactAudit(undone.id, 1); // deger 5 -> 50 (undo'nun undo'su = redo)
    expect(redone.newValue).toBe(50);

    const row = sqlite
      .prepare("SELECT value FROM facts WHERE model_id=? AND d1=? AND d2=?")
      .get(modelId, "A2", "B2") as { value: number };
    expect(row.value).toBe(50);
  });

  it("oldValue null iken (hucre o degisiklikten once yoktu) satiri siler ve rollback kaynakli kayit doner", () => {
    const dims = getModelDims(modelId);
    const uploadId = newUpload();
    upsertFacts(modelId, dims, [{ coords: ["A3", "B3"], value: 99 }], uploadId, new Date().toISOString(), 1);

    const history = listFactAudit(modelId, { coordsByDimCode: { FA_D1: "A3", FA_D2: "B3" } });
    const writeEntry = history.find((h) => h.oldValue === null && h.newValue === 99)!;

    const created = rollbackFactAudit(writeEntry.id, 1);
    expect(created.source).toBe("rollback");
    expect(created.newValue).toBeNull();

    const row = sqlite
      .prepare("SELECT value FROM facts WHERE model_id=? AND d1=? AND d2=?")
      .get(modelId, "A3", "B3");
    expect(row).toBeUndefined();
  });

  it("var olmayan bir denetim id'si icin hata firlatir", () => {
    expect(() => rollbackFactAudit(999999, 1)).toThrow();
  });
});

describe("rollbackFactAudit — coklu-olcu", () => {
  let multiModelId: number;

  beforeAll(async () => {
    multiModelId = Number(
      sqlite
        .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
        .run("FAMULTI", "Fact Audit Multi-Measure Test", new Date().toISOString()).lastInsertRowid
    );
    const d1Id = (sqlite.prepare("SELECT id FROM dimensions WHERE code='FA_D1'").get() as { id: number }).id;
    const d2Id = (sqlite.prepare("SELECT id FROM dimensions WHERE code='FA_D2'").get() as { id: number }).id;
    sqlite
      .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,1)")
      .run(multiModelId, d1Id);
    sqlite
      .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,2)")
      .run(multiModelId, d2Id);
    const mm = await import("./model-measures");
    mm.createModelMeasure({ modelId: multiModelId, code: "AMOUNT", name: "Tutar" });
    mm.createModelMeasure({ modelId: multiModelId, code: "QTY", name: "Miktar" });
  });

  function multiRow(d1: string, d2: string) {
    return sqlite
      .prepare("SELECT value, value2 FROM facts WHERE model_id=? AND d1=? AND d2=?")
      .get(multiModelId, d1, d2) as { value: number; value2: number | null } | undefined;
  }

  it("oldValues/newValues'i tasir ve rollback TUM olculeri geri yazar", () => {
    const multiDims = getModelDims(multiModelId);
    const uploadId = newUpload();
    upsertFacts(
      multiModelId,
      multiDims,
      [{ coords: ["MA1", "X"], value: 10, values: { 2: 100 } }],
      uploadId,
      new Date().toISOString(),
      1
    );
    const uploadId2 = newUpload();
    upsertFacts(
      multiModelId,
      multiDims,
      [{ coords: ["MA1", "X"], value: 20, values: { 2: 200 } }],
      uploadId2,
      new Date().toISOString(),
      1
    );

    const history = listFactAudit(multiModelId, { coordsByDimCode: { FA_D1: "MA1", FA_D2: "X" } });
    const writeEntry = history.find((h) => h.oldValue === 10 && h.newValue === 20)!;
    expect(writeEntry.oldValues).toEqual({ 2: 100 });
    expect(writeEntry.newValues).toEqual({ 2: 200 });

    const created = rollbackFactAudit(writeEntry.id, 1);
    expect(created.oldValue).toBe(20);
    expect(created.newValue).toBe(10);
    expect(created.newValues).toEqual({ 2: 100 });
    expect(multiRow("MA1", "X")).toEqual({ value: 10, value2: 100 });
  });

  it("oldValue null (hucre o degisiklikten once yoktu) ise satir silinir, coklu-olcu de dahil", () => {
    const multiDims = getModelDims(multiModelId);
    const uploadId = newUpload();
    upsertFacts(
      multiModelId,
      multiDims,
      [{ coords: ["MA2", "X"], value: 5, values: { 2: 50 } }],
      uploadId,
      new Date().toISOString(),
      1
    );
    const history = listFactAudit(multiModelId, { coordsByDimCode: { FA_D1: "MA2", FA_D2: "X" } });
    const writeEntry = history.find((h) => h.oldValue === null && h.newValue === 5)!;

    const created = rollbackFactAudit(writeEntry.id, 1);
    expect(created.source).toBe("rollback");
    expect(created.oldValues).toEqual({ 2: 50 });
    expect(multiRow("MA2", "X")).toBeUndefined();
  });
});
