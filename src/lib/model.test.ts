import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-model-tenant-${process.pid}-${Date.now()}.db`
);

let model: typeof import("./model");
let tenant: typeof import("./tenant");
let sqlite: typeof import("./db")["sqlite"];

let tenantAId: number;
let tenantBId: number;
let modelAId: number;
let modelBId: number;
let dimAId: number;
let dimBId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  model = await import("./model");
  tenant = await import("./tenant");
  const db = await import("./db");
  sqlite = db.sqlite;

  tenantAId = tenant.createTenant({ code: "tenant-a", name: "Tenant A" }).id;
  tenantBId = tenant.createTenant({ code: "tenant-b", name: "Tenant B" }).id;

  const now = new Date().toISOString();
  dimAId = Number(
    sqlite
      .prepare("INSERT INTO dimensions (tenant_id, code, name, type) VALUES (?,?,?,?)")
      .run(tenantAId, "MT_DIM_A", "Dim A", "standard").lastInsertRowid
  );
  dimBId = Number(
    sqlite
      .prepare("INSERT INTO dimensions (tenant_id, code, name, type) VALUES (?,?,?,?)")
      .run(tenantBId, "MT_DIM_B", "Dim B", "standard").lastInsertRowid
  );
  modelAId = Number(
    sqlite
      .prepare("INSERT INTO models (tenant_id, code, name, created_at) VALUES (?,?,?,?)")
      .run(tenantAId, "MT_MODEL_A", "Model A", now).lastInsertRowid
  );
  modelBId = Number(
    sqlite
      .prepare("INSERT INTO models (tenant_id, code, name, created_at) VALUES (?,?,?,?)")
      .run(tenantBId, "MT_MODEL_B", "Model B", now).lastInsertRowid
  );
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,1)")
    .run(modelAId, dimAId);
  sqlite
    .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,1)")
    .run(modelBId, dimBId);
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("getModels — tenant izolasyonu", () => {
  it("sadece istenen tenant'in modellerini dondurur", () => {
    const modelsA = model.getModels(tenantAId);
    const modelsB = model.getModels(tenantBId);
    expect(modelsA.some((m) => m.id === modelAId)).toBe(true);
    expect(modelsA.some((m) => m.id === modelBId)).toBe(false);
    expect(modelsB.some((m) => m.id === modelBId)).toBe(true);
    expect(modelsB.some((m) => m.id === modelAId)).toBe(false);
  });

  it("Tenant A'nin modeli kendi boyutunu icerir, Tenant B'ninkini icermez", () => {
    const modelsA = model.getModels(tenantAId);
    const found = modelsA.find((m) => m.id === modelAId)!;
    expect(found.dims.map((d) => d.code)).toEqual(["MT_DIM_A"]);
  });
});

describe("getModelTenantId / getDimensionTenantId — raw-id tenant dogrulama", () => {
  it("dogru tenant id'sini doner", () => {
    expect(model.getModelTenantId(modelAId)).toBe(tenantAId);
    expect(model.getModelTenantId(modelBId)).toBe(tenantBId);
    expect(model.getDimensionTenantId(dimAId)).toBe(tenantAId);
    expect(model.getDimensionTenantId(dimBId)).toBe(tenantBId);
  });

  it("baska tenant'in modelId'si ile karsilastirildiginda uyusmaz (route-level 404 icin kullanilir)", () => {
    expect(model.getModelTenantId(modelAId)).not.toBe(tenantBId);
  });

  it("var olmayan id icin null doner", () => {
    expect(model.getModelTenantId(999999)).toBeNull();
    expect(model.getDimensionTenantId(999999)).toBeNull();
  });
});
