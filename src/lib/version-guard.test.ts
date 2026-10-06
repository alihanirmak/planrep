import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-version-guard-${process.pid}-${Date.now()}.db`
);

let versionGuard: typeof import("./version-guard");
let sqlite: typeof import("./db")["sqlite"];
let reportId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  versionGuard = await import("./version-guard");
  const db = await import("./db");
  sqlite = db.sqlite;

  const now = new Date().toISOString();
  const modelId = Number(
    sqlite.prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)").run("VGTEST", "VG Test", now)
      .lastInsertRowid
  );
  reportId = Number(
    sqlite
      .prepare(
        "INSERT INTO reports (name, owner_id, model_id, definition, shared, version, created_at, updated_at) VALUES (?,?,?,?,0,1,?,?)"
      )
      .run("VG Rapor", 1, modelId, "{}", now, now).lastInsertRowid
  );
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

function currentVersion(id: number): number {
  const row = sqlite.prepare("SELECT version FROM reports WHERE id = ?").get(id) as { version: number };
  return row.version;
}

describe("versionedUpdate", () => {
  it("expectedVersion dogru/tanimsizken basarili olur ve version'u 1 artirir", () => {
    const result = versionGuard.versionedUpdate(
      "reports",
      reportId,
      currentVersion(reportId),
      undefined,
      "name = ?",
      ["Guncellenmis Ad 1"]
    );
    expect(result).toEqual({ ok: true, newVersion: 2 });
    expect(currentVersion(reportId)).toBe(2);
    const row = sqlite.prepare("SELECT name FROM reports WHERE id = ?").get(reportId) as { name: string };
    expect(row.name).toBe("Guncellenmis Ad 1");
  });

  it("expectedVersion dogru oldugunda da basarili olur", () => {
    const before = currentVersion(reportId);
    const result = versionGuard.versionedUpdate(
      "reports",
      reportId,
      before,
      before,
      "name = ?",
      ["Guncellenmis Ad 2"]
    );
    expect(result).toEqual({ ok: true, newVersion: before + 1 });
  });

  it("expectedVersion uyusmazsa stale_expected_version ile basarisiz olur, hicbir sey degismez", () => {
    const before = currentVersion(reportId);
    const nameBefore = (sqlite.prepare("SELECT name FROM reports WHERE id = ?").get(reportId) as { name: string }).name;
    const result = versionGuard.versionedUpdate(
      "reports",
      reportId,
      before,
      before - 1, // bilerek yanlis/eski versiyon
      "name = ?",
      ["Bu Yazilmamali"]
    );
    expect(result).toEqual({ ok: false, reason: "stale_expected_version" });
    expect(currentVersion(reportId)).toBe(before);
    const nameAfter = (sqlite.prepare("SELECT name FROM reports WHERE id = ?").get(reportId) as { name: string }).name;
    expect(nameAfter).toBe(nameBefore);
  });

  it("yaris durumu (currentVersion parametresi DB'deki gercek versiyonla uyusmuyor, expectedVersion verilmemis) race_condition ile basarisiz olur", () => {
    const actualVersion = currentVersion(reportId);
    const staleVersion = actualVersion - 1; // caller'in elindeki eski bir "snapshot"
    const result = versionGuard.versionedUpdate(
      "reports",
      reportId,
      staleVersion, // DB'deki gercek versiyonla uyusmuyor
      undefined, // expectedVersion kontrolu YOK, dogrudan UPDATE denenir
      "name = ?",
      ["Bu Da Yazilmamali"]
    );
    expect(result).toEqual({ ok: false, reason: "race_condition" });
    expect(currentVersion(reportId)).toBe(actualVersion); // degismedi
  });

  it("dashboards tablosunda da calisir (ayni fonksiyon, farkli tablo)", () => {
    const now = new Date().toISOString();
    const dashId = Number(
      sqlite
        .prepare(
          "INSERT INTO dashboards (name, owner_id, definition, shared, version, created_at, updated_at) VALUES (?,?,?,0,1,?,?)"
        )
        .run("VG Dashboard", 1, "{}", now, now).lastInsertRowid
    );
    const result = versionGuard.versionedUpdate("dashboards", dashId, 1, 1, "name = ?", ["Yeni Ad"]);
    expect(result).toEqual({ ok: true, newVersion: 2 });
    const row = sqlite.prepare("SELECT name, version FROM dashboards WHERE id = ?").get(dashId) as {
      name: string;
      version: number;
    };
    expect(row).toEqual({ name: "Yeni Ad", version: 2 });
  });
});
