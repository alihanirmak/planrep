import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-api-keys-${process.pid}-${Date.now()}.db`
);

let apiKeys: typeof import("./api-keys");
let tenant: typeof import("./tenant");
let sqlite: typeof import("./db")["sqlite"];
let tenantAId: number;
let tenantBId: number;
let userAId: number;
let userBId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  apiKeys = await import("./api-keys");
  tenant = await import("./tenant");
  const db = await import("./db");
  sqlite = db.sqlite;

  tenantAId = tenant.createTenant({ code: "ak-tenant-a", name: "AK Tenant A" }).id;
  tenantBId = tenant.createTenant({ code: "ak-tenant-b", name: "AK Tenant B" }).id;
  const now = new Date().toISOString();
  userAId = Number(
    sqlite
      .prepare("INSERT INTO users (tenant_id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)")
      .run(tenantAId, "akuser.a@test.local", "AK User A", "x", "planner", now).lastInsertRowid
  );
  userBId = Number(
    sqlite
      .prepare("INSERT INTO users (tenant_id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)")
      .run(tenantBId, "akuser.b@test.local", "AK User B", "x", "planner", now).lastInsertRowid
  );
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("createApiKey / verifyApiKey", () => {
  it("olusturulan ham anahtar basariyla dogrulanir ve dogru tenant/kullaniciyi doner", () => {
    const created = apiKeys.createApiKey(tenantAId, userAId, "Power BI");
    expect(created.rawKey.startsWith("pr_live_")).toBe(true);
    expect(created.keyPrefix.length).toBeGreaterThan(0);

    const verified = apiKeys.verifyApiKey(created.rawKey);
    expect(verified).toEqual({
      apiKeyId: created.id,
      tenantId: tenantAId,
      userId: userAId,
      role: "planner",
      locale: "tr",
    });
  });

  it("yanlis/rastgele bir anahtar icin null doner", () => {
    expect(apiKeys.verifyApiKey("pr_live_" + "0".repeat(48))).toBeNull();
  });

  it("beklenen prefix'e sahip olmayan bir deger icin null doner", () => {
    expect(apiKeys.verifyApiKey("not-a-valid-prefix")).toBeNull();
  });

  it("basarili dogrulama sonrasi lastUsedAt guncellenir", () => {
    const created = apiKeys.createApiKey(tenantAId, userAId, "Tableau");
    const before = apiKeys.listApiKeys(tenantAId, userAId).find((k) => k.id === created.id)!;
    expect(before.lastUsedAt).toBeNull();

    apiKeys.verifyApiKey(created.rawKey);

    const after = apiKeys.listApiKeys(tenantAId, userAId).find((k) => k.id === created.id)!;
    expect(after.lastUsedAt).not.toBeNull();
  });
});

describe("listApiKeys — kullanici/tenant izolasyonu", () => {
  it("sadece istenen kullanicinin anahtarlarini dondurur", () => {
    apiKeys.createApiKey(tenantBId, userBId, "User B Key");
    const listA = apiKeys.listApiKeys(tenantAId, userAId);
    const listB = apiKeys.listApiKeys(tenantBId, userBId);
    expect(listA.every((k) => k.name !== "User B Key")).toBe(true);
    expect(listB.some((k) => k.name === "User B Key")).toBe(true);
  });
});

describe("revokeApiKey", () => {
  it("iptal edilen anahtar artik dogrulanamaz", () => {
    const created = apiKeys.createApiKey(tenantAId, userAId, "Revoke Me");
    expect(apiKeys.verifyApiKey(created.rawKey)).not.toBeNull();

    const revoked = apiKeys.revokeApiKey(tenantAId, userAId, created.id);
    expect(revoked).toBe(true);
    expect(apiKeys.verifyApiKey(created.rawKey)).toBeNull();
  });

  it("baska bir kullanicinin anahtarini iptal etmeye calismak basarisiz olur (false doner)", () => {
    const created = apiKeys.createApiKey(tenantAId, userAId, "Not Yours");
    const result = apiKeys.revokeApiKey(tenantBId, userBId, created.id);
    expect(result).toBe(false);
    expect(apiKeys.verifyApiKey(created.rawKey)).not.toBeNull();
  });

  it("zaten iptal edilmis bir anahtari tekrar iptal etmek false doner", () => {
    const created = apiKeys.createApiKey(tenantAId, userAId, "Double Revoke");
    apiKeys.revokeApiKey(tenantAId, userAId, created.id);
    const second = apiKeys.revokeApiKey(tenantAId, userAId, created.id);
    expect(second).toBe(false);
  });
});
