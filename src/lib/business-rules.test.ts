import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DimInfo } from "./model";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-business-rules-${process.pid}-${Date.now()}.db`
);

let br: typeof import("./business-rules");
let sqlite: typeof import("./db")["sqlite"];
let modelId: number;

const dims: DimInfo[] = [
  {
    id: 1,
    code: "ACC",
    name: "Hesap",
    type: "standard",
    slot: 1,
    members: [
      { id: 1, code: "REVENUE", name: "Gelir", parentId: null, orderIdx: 0 },
      { id: 2, code: "OPEX", name: "Gider", parentId: null, orderIdx: 1 },
    ],
  },
  { id: 2, code: "VER", name: "Versiyon", type: "version", slot: 2, members: [] },
];

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  br = await import("./business-rules");
  const db = await import("./db");
  sqlite = db.sqlite;
  modelId = Number(
    sqlite
      .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
      .run("BRTEST", "Business Rule Test", new Date().toISOString()).lastInsertRowid
  );
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("createBusinessRule / listBusinessRules / updateBusinessRule / deleteBusinessRule", () => {
  it("kural olusturulup okunabilir", () => {
    const rule = br.createBusinessRule({
      tenantId: 1,
      modelId,
      name: "Bütçe negatif olamaz",
      scopeFilters: { ACC: ["OPEX"] },
      op: "<",
      value: 0,
      severity: "block",
      message: "OPEX negatif olamaz",
    });
    expect(rule.id).toBeGreaterThan(0);
    expect(br.getBusinessRule(rule.id)).toEqual(rule);
  });

  it("listBusinessRules modelId'ye gore filtreler", () => {
    const otherModelId = Number(
      sqlite
        .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
        .run("BRTEST2", "Other", new Date().toISOString()).lastInsertRowid
    );
    br.createBusinessRule({
      tenantId: 1,
      modelId: otherModelId,
      name: "Diger model kurali",
      scopeFilters: {},
      op: ">",
      value: 1000000,
      severity: "warn",
    });
    const rules = br.listBusinessRules({ modelId: otherModelId });
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("Diger model kurali");
  });

  it("updateBusinessRule alanlari gunceller", () => {
    const rule = br.createBusinessRule({
      tenantId: 1,
      modelId,
      name: "Guncellenecek",
      scopeFilters: {},
      op: ">",
      value: 100,
      severity: "warn",
    });
    const updated = br.updateBusinessRule(rule.id, { value: 200, severity: "block" });
    expect(updated?.value).toBe(200);
    expect(updated?.severity).toBe("block");
    expect(updated?.name).toBe("Guncellenecek"); // degismeyen alan korunur
  });

  it("deleteBusinessRule kuralı siler", () => {
    const rule = br.createBusinessRule({
      tenantId: 1,
      modelId,
      name: "Silinecek",
      scopeFilters: {},
      op: ">",
      value: 1,
      severity: "warn",
    });
    br.deleteBusinessRule(rule.id);
    expect(br.getBusinessRule(rule.id)).toBeNull();
  });

  it("active=false kurallar listBusinessRules(activeOnly) ile gelmez", () => {
    const rule = br.createBusinessRule({
      tenantId: 1,
      modelId,
      name: "Pasif kural",
      scopeFilters: {},
      op: ">",
      value: 1,
      severity: "warn",
    });
    br.updateBusinessRule(rule.id, { active: false });
    const active = br.listBusinessRules({ modelId, activeOnly: true });
    expect(active.find((r) => r.id === rule.id)).toBeUndefined();
  });
});

describe("evaluateBusinessRules", () => {
  it("kapsam ve esik eslesirse block ihlali doner", () => {
    const rule = br.createBusinessRule({
      tenantId: 1,
      modelId,
      name: "OPEX negatif olamaz",
      scopeFilters: { ACC: ["OPEX"] },
      op: "<",
      value: 0,
      severity: "block",
    });
    const result = br.evaluateBusinessRules(modelId, dims, { ACC: "OPEX", VER: "BUDGET" }, -100);
    expect(result.blocking.map((v) => v.rule.id)).toContain(rule.id);
    expect(result.warnings).toEqual([]);
  });

  it("kapsam disindaki boyuta uygulanmaz", () => {
    const result = br.evaluateBusinessRules(modelId, dims, { ACC: "REVENUE", VER: "BUDGET" }, -100);
    expect(result.blocking.find((v) => v.rule.name === "OPEX negatif olamaz")).toBeUndefined();
  });

  it("esik asilmazsa ihlal olusmaz", () => {
    const result = br.evaluateBusinessRules(modelId, dims, { ACC: "OPEX", VER: "BUDGET" }, 50);
    expect(result.blocking.find((v) => v.rule.name === "OPEX negatif olamaz")).toBeUndefined();
  });

  it("warn siddetindeki kural blocking'e degil warnings'e girer", () => {
    const rule = br.createBusinessRule({
      tenantId: 1,
      modelId,
      name: "Buyuk deger uyarisi",
      scopeFilters: {},
      op: ">",
      value: 1000000,
      severity: "warn",
    });
    const result = br.evaluateBusinessRules(modelId, dims, { ACC: "REVENUE", VER: "BUDGET" }, 2000000);
    expect(result.warnings.map((v) => v.rule.id)).toContain(rule.id);
    expect(result.blocking.find((v) => v.rule.id === rule.id)).toBeUndefined();
  });
});

describe("BusinessRuleError", () => {
  it("ihlal mesajlarini birlestirir", () => {
    const rule = br.createBusinessRule({
      tenantId: 1,
      modelId,
      name: "Test Kural",
      scopeFilters: {},
      op: ">",
      value: 0,
      severity: "block",
      message: "Özel mesaj",
    });
    const err = new br.BusinessRuleError([{ rule, value: 5 }]);
    expect(err.message).toContain("Özel mesaj");
  });
});
