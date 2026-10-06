import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-tenant-${process.pid}-${Date.now()}.db`
);

let tenant: typeof import("./tenant");
let sqlite: typeof import("./db")["sqlite"];

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  tenant = await import("./tenant");
  const db = await import("./db");
  sqlite = db.sqlite;
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("createTenant / getTenant / getTenantByCode", () => {
  it("default tenant (id=1) modul yuklenirken otomatik olusturulur", () => {
    const t = tenant.getTenant(1);
    expect(t).not.toBeNull();
    expect(t?.code).toBe("default");
  });

  it("yeni bir tenant olusturup id ve code ile geri okunabilir", () => {
    const created = tenant.createTenant({ code: "acme-corp", name: "Acme Corp" });
    expect(created.id).toBeGreaterThan(1);
    expect(tenant.getTenant(created.id)).toEqual(created);
    expect(tenant.getTenantByCode("acme-corp")).toEqual(created);
  });

  it("var olmayan id/code icin null doner", () => {
    expect(tenant.getTenant(999999)).toBeNull();
    expect(tenant.getTenantByCode("no-such-tenant")).toBeNull();
  });
});
