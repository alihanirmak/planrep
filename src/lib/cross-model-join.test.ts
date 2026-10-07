import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-cross-model-join-${process.pid}-${Date.now()}.db`
);

let computeJoinValues: typeof import("./cross-model-join")["computeJoinValues"];
let da: typeof import("./dimension-attributes");
let sqlite: typeof import("./db")["sqlite"];

let primaryModelId: number;
let secondaryModelId: number;
let ccAllId: number;
let cc1Id: number;
let cc2Id: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  const joinMod = await import("./cross-model-join");
  computeJoinValues = joinMod.computeJoinValues;
  da = await import("./dimension-attributes");
  const db = await import("./db");
  sqlite = db.sqlite;

  const now = new Date().toISOString();

  // Birincil model: CC (Masraf Yeri) boyutu, hiyerarsi CC_ALL -> CC1, CC2.
  const ccDimId = Number(
    sqlite.prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)").run("JCC", "Masraf Yeri", "standard")
      .lastInsertRowid
  );
  const insMem = sqlite.prepare(
    "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
  );
  ccAllId = Number(insMem.run(ccDimId, "CC_ALL", "Tum Masraf Yerleri", null, 0).lastInsertRowid);
  cc1Id = Number(insMem.run(ccDimId, "CC1", "Masraf 1", ccAllId, 1).lastInsertRowid);
  cc2Id = Number(insMem.run(ccDimId, "CC2", "Masraf 2", ccAllId, 2).lastInsertRowid);

  primaryModelId = Number(
    sqlite.prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)").run("JPRIMARY", "Join Primary", now)
      .lastInsertRowid
  );
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)")
    .run(primaryModelId, ccDimId, 1);

  // REGION_CODE attribute'u CC1/CC2'ye tanimlanir, CC_ALL'a tanimlanmaz
  // (rollup'in sadece yapraklardan geldigini dogrulamak icin).
  const attr = da.createDimensionAttribute({
    dimensionId: ccDimId,
    code: "REGION_CODE",
    name: "Bolge Kodu",
    type: "text",
  });
  da.setMemberAttributeValue(cc1Id, attr.id, "EMEA");
  da.setMemberAttributeValue(cc2Id, attr.id, "APAC");

  // Ikincil model: REGION boyutu, dogrudan EMEA/APAC kodlu uyeler + fact.
  const regionDimId = Number(
    sqlite.prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)").run("JREGION", "Bolge", "standard")
      .lastInsertRowid
  );
  insMem.run(regionDimId, "EMEA", "EMEA", null, 0);
  insMem.run(regionDimId, "APAC", "APAC", null, 1);

  secondaryModelId = Number(
    sqlite.prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)").run("JSECOND", "Join Secondary", now)
      .lastInsertRowid
  );
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)")
    .run(secondaryModelId, regionDimId, 1);
  sqlite
    .prepare("INSERT INTO model_measures (model_id, code, name, slot, created_at) VALUES (?,?,?,?,?)")
    .run(secondaryModelId, "AMOUNT", "Tutar", 1, now);
  sqlite
    .prepare("INSERT INTO model_measures (model_id, code, name, slot, created_at) VALUES (?,?,?,?,?)")
    .run(secondaryModelId, "QTY", "Miktar", 2, now);
  sqlite
    .prepare("INSERT INTO facts (model_id, d1, value, value2, upload_id, updated_at) VALUES (?,?,?,?,NULL,?)")
    .run(secondaryModelId, "EMEA", 100, 11, now);
  sqlite
    .prepare("INSERT INTO facts (model_id, d1, value, value2, upload_id, updated_at) VALUES (?,?,?,?,NULL,?)")
    .run(secondaryModelId, "APAC", 200, 22, now);
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("computeJoinValues", () => {
  it("via=attribute: yaprak uyeler kendi REGION_CODE degerine karsilik gelen ikincil toplami alir", () => {
    const result = computeJoinValues(primaryModelId, "JCC", {
      id: "j1",
      name: "Bolge Tutari",
      modelId: secondaryModelId,
      via: "attribute",
      attributeCode: "REGION_CODE",
      targetDim: "JREGION",
    });
    expect(result.CC1).toBe(100);
    expect(result.CC2).toBe(200);
  });

  it("via=attribute: ara (CC_ALL) uye, yaprak cocuklarinin eslesen degerlerinin toplamini alir (rollup)", () => {
    const result = computeJoinValues(primaryModelId, "JCC", {
      id: "j1",
      name: "Bolge Tutari",
      modelId: secondaryModelId,
      via: "attribute",
      attributeCode: "REGION_CODE",
      targetDim: "JREGION",
    });
    expect(result.CC_ALL).toBe(300);
  });

  it("measureCode belirtilince ikincil modelin ilgili olcu kolonu (value2) kullanilir", () => {
    const result = computeJoinValues(primaryModelId, "JCC", {
      id: "j2",
      name: "Bolge Miktari",
      modelId: secondaryModelId,
      measureCode: "QTY",
      via: "attribute",
      attributeCode: "REGION_CODE",
      targetDim: "JREGION",
    });
    expect(result.CC1).toBe(11);
    expect(result.CC2).toBe(22);
    expect(result.CC_ALL).toBe(33);
  });

  it("via=dimension: birincil uye kodu dogrudan ikincil hedef boyutun kodu olarak eslesir", () => {
    // Gecici olarak CC1/CC2'nin kodlarini EMEA/APAC'a esit kabul eden bagimsiz
    // bir senaryo kurmak yerine, dogrudan JREGION kodlarini tasiyan bir boyut
    // kullanimini (ayni model_dimensions tablosuna REGION boyutunu BIRINCIL
    // modele de ekleyerek) test ediyoruz.
    const now = new Date().toISOString();
    const sharedDimId = Number(
      sqlite.prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)").run("JSHARED", "Paylasilan", "standard")
        .lastInsertRowid
    );
    sqlite
      .prepare("INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)")
      .run(sharedDimId, "EMEA", "EMEA", null, 0);
    sqlite
      .prepare("INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)")
      .run(sharedDimId, "APAC", "APAC", null, 1);
    const sharedModelId = Number(
      sqlite.prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)").run("JSHAREDM", "Shared Model", now)
        .lastInsertRowid
    );
    sqlite
      .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)")
      .run(sharedModelId, sharedDimId, 1);

    const result = computeJoinValues(sharedModelId, "JSHARED", {
      id: "j3",
      name: "Direkt Esleme",
      modelId: secondaryModelId,
      via: "dimension",
      targetDim: "JREGION",
    });
    expect(result.EMEA).toBe(100);
    expect(result.APAC).toBe(200);
  });

  it("gecersiz targetDim icin bos nesne doner", () => {
    const result = computeJoinValues(primaryModelId, "JCC", {
      id: "j4",
      name: "Yok",
      modelId: secondaryModelId,
      via: "dimension",
      targetDim: "NOPE",
    });
    expect(result).toEqual({});
  });

  it("gecersiz primaryDimCode icin bos nesne doner", () => {
    const result = computeJoinValues(primaryModelId, "NOPE", {
      id: "j5",
      name: "Yok",
      modelId: secondaryModelId,
      via: "dimension",
      targetDim: "JREGION",
    });
    expect(result).toEqual({});
  });
});
