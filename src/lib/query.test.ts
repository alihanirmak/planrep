import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-query-${process.pid}-${Date.now()}.db`
);

let runQuery: typeof import("./query")["runQuery"];
let sqlite: typeof import("./db")["sqlite"];

let modelId: number;
const CHILD_COUNT = 450; // SQL_IN_CHUNK_SIZE (400) asilacak sekilde buyuk secildi

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  const queryMod = await import("./query");
  runQuery = queryMod.runQuery;
  const db = await import("./db");
  sqlite = db.sqlite;

  const now = new Date().toISOString();

  const ccDimId = Number(
    sqlite.prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)").run("CC", "Masraf Yeri", "standard")
      .lastInsertRowid
  );
  const verDimId = Number(
    sqlite.prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)").run("VER", "Versiyon", "version")
      .lastInsertRowid
  );

  const insMem = sqlite.prepare(
    "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
  );
  const ccAll = insMem.run(ccDimId, "CC_ALL", "Tum Masraf Yerleri", null, 0);
  const ccAllId = Number(ccAll.lastInsertRowid);
  for (let i = 0; i < CHILD_COUNT; i++) {
    insMem.run(ccDimId, `CC${i}`, `Masraf ${i}`, ccAllId, i + 1);
  }
  insMem.run(verDimId, "BUDGET", "Butce", null, 0);
  insMem.run(verDimId, "ACTUAL", "Gerceklesen", null, 1);

  modelId = Number(
    sqlite.prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)").run("QTEST", "Query Test", now)
      .lastInsertRowid
  );
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)")
    .run(modelId, ccDimId, 1);
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)")
    .run(modelId, verDimId, 2);

  const insFact = sqlite.prepare(
    "INSERT INTO facts (model_id, d1, d2, value, upload_id, updated_at) VALUES (?,?,?,?,NULL,?)"
  );
  for (let i = 0; i < CHILD_COUNT; i++) {
    insFact.run(modelId, `CC${i}`, "BUDGET", 10, now);
    insFact.run(modelId, `CC${i}`, "ACTUAL", 5, now);
  }
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("runQuery", () => {
  it("gecersiz boyut kodu icin hata doner", () => {
    const result = runQuery(modelId, "NOPE", "VER", {});
    expect(result).toEqual({ error: "invalid_dims" });
  });

  it("ayni satir/sutun boyutu secilirse hata doner", () => {
    const result = runQuery(modelId, "CC", "CC", {});
    expect(result).toEqual({ error: "invalid_dims" });
  });

  it("filtre yokken tum yaprak uyelerin toplamini (rollup) hesaplar", () => {
    const result = runQuery(modelId, "CC", "VER", {});
    if ("error" in result) throw new Error("hata bekleniyordu yoktu: " + result.error);

    expect(result.grandTotal).toBe(CHILD_COUNT * 15);
    expect(result.colTotals).toEqual({ BUDGET: CHILD_COUNT * 10, ACTUAL: CHILD_COUNT * 5 });

    const rootRow = result.rows.find((r) => r.code === "CC_ALL");
    expect(rootRow).toBeDefined();
    expect(rootRow!.total).toBe(CHILD_COUNT * 15);
    expect(rootRow!.cells).toEqual({ BUDGET: CHILD_COUNT * 10, ACTUAL: CHILD_COUNT * 5 });
  });

  it("tek bir yaprak secilince (filtre) sadece o uyenin verisini dondurur", () => {
    const result = runQuery(modelId, "CC", "VER", { CC: ["CC7"] });
    if ("error" in result) throw new Error("hata bekleniyordu yoktu: " + result.error);
    expect(result.grandTotal).toBe(15);
    const row = result.rows.find((r) => r.code === "CC7");
    expect(row?.cells).toEqual({ BUDGET: 10, ACTUAL: 5 });
  });

  it("parent (CC_ALL) filtresi SQL IN(...) chunk sinirini (400) asan alt uye listesine genisler ve toplamlar dogru kalir", () => {
    const result = runQuery(modelId, "CC", "VER", { CC: ["CC_ALL"] });
    if ("error" in result) throw new Error("hata bekleniyordu yoktu: " + result.error);
    expect(result.grandTotal).toBe(CHILD_COUNT * 15);
    expect(result.colTotals).toEqual({ BUDGET: CHILD_COUNT * 10, ACTUAL: CHILD_COUNT * 5 });
  });

  it("erisim (allowedSets) bos kume donduruyorsa sonuc bos doner", async () => {
    const access = await import("./access");
    access.setUserAccess(777, [{ dimensionId: await ccDimensionId(), memberCodes: ["CC1"] }]);
    const result = runQuery(modelId, "CC", "VER", { CC: ["CC2"] }, 777);
    if ("error" in result) throw new Error("hata bekleniyordu yoktu: " + result.error);
    expect(result.rows).toEqual([]);
    expect(result.grandTotal).toBe(0);
  });
});

async function ccDimensionId(): Promise<number> {
  const row = sqlite.prepare("SELECT id FROM dimensions WHERE code='CC'").get() as { id: number };
  return row.id;
}
