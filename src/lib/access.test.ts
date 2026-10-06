import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { SessionUser } from "./session";

// access.ts -> model.ts -> db/index.ts zincirinde modul yuklenirken yan etkili
// (dosya olusturma + DDL + demo veri seed) kod calisiyor; bu yuzden
// DATABASE_PATH'i gercek import'tan ONCE, benzersiz bir test dosyasina
// ayarlayip ardindan dynamic import ile modulu yukluyoruz.
const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-access-${process.pid}-${Date.now()}.db`
);

let restrictCodes: typeof import("./access")["restrictCodes"];
let allowedSets: typeof import("./access")["allowedSets"];
let getUserAccess: typeof import("./access")["getUserAccess"];
let setUserAccess: typeof import("./access")["setUserAccess"];
let canAccessCommentEntity: typeof import("./access")["canAccessCommentEntity"];
let sqlite: typeof import("./db")["sqlite"];

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  const access = await import("./access");
  restrictCodes = access.restrictCodes;
  allowedSets = access.allowedSets;
  getUserAccess = access.getUserAccess;
  setUserAccess = access.setUserAccess;
  canAccessCommentEntity = access.canAccessCommentEntity;
  const db = await import("./db");
  sqlite = db.sqlite;
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("restrictCodes", () => {
  it("erisim tanimsizsa (undefined) istenen listeyi degistirmeden dondurur", () => {
    expect(restrictCodes(["A", "B"], undefined)).toEqual(["A", "B"]);
    expect(restrictCodes(undefined, undefined)).toBeUndefined();
  });

  it("istek yoksa (tum uyeler) erisim kumesinin tamamini dondurur", () => {
    expect(restrictCodes(undefined, new Set(["A", "B"]))).toEqual(["A", "B"]);
    expect(restrictCodes([], new Set(["A", "B"]))).toEqual(["A", "B"]);
  });

  it("istek ve erisim kesisimini dondurur", () => {
    expect(restrictCodes(["A", "B", "C"], new Set(["B", "C", "D"]))).toEqual(["B", "C"]);
  });

  it("kesisim bossa bos dizi dondurur (tum satirlar filtrelenir)", () => {
    expect(restrictCodes(["A"], new Set(["B"]))).toEqual([]);
  });
});

describe("getUserAccess / setUserAccess / allowedSets", () => {
  it("setUserAccess kaydedip getUserAccess ile geri okunabilir", () => {
    const userId = 9001;
    setUserAccess(userId, [
      { dimensionId: 1, memberCodes: ["CC100", "CC200"] },
      { dimensionId: 2, memberCodes: [] }, // bos liste kaydedilmez
    ]);
    const entries = getUserAccess(userId);
    expect(entries).toEqual([{ dimensionId: 1, memberCodes: ["CC100", "CC200"] }]);
  });

  it("setUserAccess tekrar cagrildiginda onceki erisimi tamamen degistirir", () => {
    const userId = 9002;
    setUserAccess(userId, [{ dimensionId: 1, memberCodes: ["A"] }]);
    setUserAccess(userId, [{ dimensionId: 1, memberCodes: ["B"] }]);
    expect(getUserAccess(userId)).toEqual([{ dimensionId: 1, memberCodes: ["B"] }]);
  });

  it("allowedSets, erisim tanimli olan boyut icin alt uyeleri de genisletir", () => {
    const userId = 9003;
    const parent = { id: 1, code: "CC_ALL", name: "Tum", parentId: null, orderIdx: 0 };
    const child = { id: 2, code: "CC100", name: "Satis", parentId: 1, orderIdx: 0 };
    const dims = [
      { id: 1, code: "COSTCENTER", name: "Masraf Yeri", type: "standard", slot: 1, members: [parent, child] },
    ];
    setUserAccess(userId, [{ dimensionId: 1, memberCodes: ["CC_ALL"] }]);
    const sets = allowedSets(userId, dims);
    expect(sets.get("COSTCENTER")).toEqual(new Set(["CC_ALL", "CC100"]));
  });

  it("erisim tanimli olmayan boyutlar icin kisitsiz (undefined) doner", () => {
    const userId = 9004;
    const dims = [
      { id: 5, code: "ACCOUNT", name: "Hesap", type: "standard", slot: 1, members: [] },
    ];
    setUserAccess(userId, []);
    const sets = allowedSets(userId, dims);
    expect(sets.get("ACCOUNT")).toBeUndefined();
  });
});

describe("canAccessCommentEntity", () => {
  const now = new Date().toISOString();
  let ownerId: number;
  let otherId: number;
  let ownedReportId: number;
  let sharedReportId: number;
  let privateReportId: number;

  beforeAll(() => {
    ownerId = Number(
      sqlite
        .prepare(
          "INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)"
        )
        .run("owner@test.local", "Owner", "x", "planner", now).lastInsertRowid
    );
    otherId = Number(
      sqlite
        .prepare(
          "INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)"
        )
        .run("other@test.local", "Other", "x", "planner", now).lastInsertRowid
    );
    const modelId = Number(
      sqlite
        .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
        .run("ACCTEST", "Acc Test", now).lastInsertRowid
    );
    ownedReportId = Number(
      sqlite
        .prepare(
          "INSERT INTO reports (name, owner_id, model_id, definition, shared, created_at, updated_at) VALUES (?,?,?,?,0,?,?)"
        )
        .run("Owned", ownerId, modelId, "{}", now, now).lastInsertRowid
    );
    sharedReportId = Number(
      sqlite
        .prepare(
          "INSERT INTO reports (name, owner_id, model_id, definition, shared, created_at, updated_at) VALUES (?,?,?,?,1,?,?)"
        )
        .run("Shared", ownerId, modelId, "{}", now, now).lastInsertRowid
    );
    privateReportId = Number(
      sqlite
        .prepare(
          "INSERT INTO reports (name, owner_id, model_id, definition, shared, created_at, updated_at) VALUES (?,?,?,?,0,?,?)"
        )
        .run("Private", ownerId, modelId, "{}", now, now).lastInsertRowid
    );
  });

  it("sahip kendi raporuna erisebilir", () => {
    const session = fakeSession(ownerId, "planner");
    expect(canAccessCommentEntity(session, "report", String(ownedReportId))).toBe(true);
  });

  it("paylasilan (shared) rapora baska bir kullanici erisebilir", () => {
    const session = fakeSession(otherId, "planner");
    expect(canAccessCommentEntity(session, "report", String(sharedReportId))).toBe(true);
  });

  it("paylasilmayan rapora sahibi olmayan erisemez", () => {
    const session = fakeSession(otherId, "planner");
    expect(canAccessCommentEntity(session, "report", String(privateReportId))).toBe(false);
  });

  it("admin her zaman erisebilir", () => {
    const session = fakeSession(otherId, "admin");
    expect(canAccessCommentEntity(session, "report", String(privateReportId))).toBe(true);
  });

  it("baska bir tenant'in admin'i (ayni tenantId'ye sahip olmayan) erisemez (cross-tenant sizinti onlemi)", () => {
    const otherTenantAdmin: SessionUser = {
      id: otherId,
      tenantId: 2,
      role: "admin",
      email: "admin@tenant2.local",
      name: "Tenant2 Admin",
      locale: "tr",
    };
    expect(canAccessCommentEntity(otherTenantAdmin, "report", String(privateReportId))).toBe(false);
    expect(canAccessCommentEntity(otherTenantAdmin, "report", String(sharedReportId))).toBe(false);
  });

  it("var olmayan entity icin false doner", () => {
    const session = fakeSession(ownerId, "planner");
    expect(canAccessCommentEntity(session, "report", "999999")).toBe(false);
  });

  it("'cell' turu admin olmayanlar icin daima false doner", () => {
    const session = fakeSession(ownerId, "planner");
    expect(canAccessCommentEntity(session, "cell", "anything")).toBe(false);
  });
});

function fakeSession(id: number, role: SessionUser["role"]): SessionUser {
  return { id, tenantId: 1, role, email: `${id}@test.local`, name: `User ${id}`, locale: "tr" };
}
