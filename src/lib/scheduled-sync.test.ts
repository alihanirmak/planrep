import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-scheduled-sync-${process.pid}-${Date.now()}.db`
);

let sched: typeof import("./scheduled-sync");
let connectorConfigs: typeof import("./connector-configs");
let sqlite: typeof import("./db")["sqlite"];

let userId: number;
let modelId: number;
let sapMockConfigId: number;

// Model, lib/connectors/sap-mock.ts'in uretttigi kolonlarla (CostCenter,
// GLAccount, AmountInCompanyCodeCurrency) eslesecek sekilde kuruluyor;
// Ledger/FiscalPeriod/Version kolonlari testte kasitli olarak yoksayiliyor
// (mapping'de "").
const GOOD_MAPPING = {
  CostCenter: "COSTCENTER",
  GLAccount: "ACCOUNT",
  AmountInCompanyCodeCurrency: "DEGER",
  Ledger: "",
  FiscalPeriod: "",
  Version: "",
};

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  delete process.env.SAP_ODATA_URL;
  delete process.env.SAP_USER;
  delete process.env.SAP_PASS;
  delete process.env.SAP_ODATA_ENTITIES;
  sched = await import("./scheduled-sync");
  connectorConfigs = await import("./connector-configs");
  const db = await import("./db");
  sqlite = db.sqlite;

  const now = new Date().toISOString();
  userId = Number(
    sqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, locale, created_at) VALUES (?,?,?,?,?,?)")
      .run("sched@example.com", "Sched Admin", "hash", "admin", "tr", now).lastInsertRowid
  );

  // db/index.ts'teki seed() COSTCENTER/ACCOUNT boyutlarini zaten demo verisiyle
  // (CC100-CC500, REV_PROD/REV_SVC/PERSONNEL/TRAVEL/IT_COST/RENT/OTHER) olusturur
  // — bu kodlar lib/connectors/sap-mock.ts'in urettigi degerlerle tam eslesir,
  // bu yuzden yeni bir boyut yaratmak yerine mevcut seed boyutlarini kullaniyoruz
  // (ayni kod icin "dimensions.code" UNIQUE kisitlamasina carpmamak icin).
  const ccDimId = (sqlite.prepare("SELECT id FROM dimensions WHERE code = 'COSTCENTER'").get() as { id: number }).id;
  const accDimId = (sqlite.prepare("SELECT id FROM dimensions WHERE code = 'ACCOUNT'").get() as { id: number }).id;

  modelId = Number(
    sqlite
      .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
      .run("SCHEDTEST", "Scheduled Sync Test", now).lastInsertRowid
  );
  sqlite.prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)").run(modelId, ccDimId, 1);
  sqlite.prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)").run(modelId, accDimId, 2);

  const configs = connectorConfigs.listConnectorConfigs();
  sapMockConfigId = configs.find((c) => c.type === "sap-mock")!.id;
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("createScheduledSync / getScheduledSync / listScheduledSyncs", () => {
  it("olusturur ve roundtrip ile geri okur", () => {
    const s = sched.createScheduledSync({
      name: "Günlük Aktüel",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });
    expect(s.active).toBe(true);
    expect(s.lastRunAt).toBeNull();
    expect(s.mapping).toEqual(GOOD_MAPPING);

    const fetched = sched.getScheduledSync(s.id);
    expect(fetched).toEqual(s);
  });

  it("listScheduledSyncs en yeniyi en basta dondurur", () => {
    const before = sched.listScheduledSyncs();
    const s = sched.createScheduledSync({
      name: "İkinci Senkronizasyon",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 30,
      createdBy: userId,
    });
    const after = sched.listScheduledSyncs();
    expect(after.length).toBe(before.length + 1);
    expect(after[0].id).toBe(s.id);
  });
});

describe("updateScheduledSync / deleteScheduledSync", () => {
  it("active ve intervalMinutes alanlarini gunceller", () => {
    const s = sched.createScheduledSync({
      name: "Güncellenecek",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });
    const updated = sched.updateScheduledSync(s.id, { active: false, intervalMinutes: 120 });
    expect(updated?.active).toBe(false);
    expect(updated?.intervalMinutes).toBe(120);
  });

  it("deleteScheduledSync kaydi siler", () => {
    const s = sched.createScheduledSync({
      name: "Silinecek",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });
    sched.deleteScheduledSync(s.id);
    expect(sched.getScheduledSync(s.id)).toBeNull();
  });
});

describe("runScheduledSync", () => {
  it("basarili calistirmada last_status=success, last_inserted doldurulur ve upload olusur", async () => {
    const s = sched.createScheduledSync({
      name: "Başarılı Çalışma",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });
    const outcome = await sched.runScheduledSync(s.id);
    expect(outcome.status).toBe("success");
    expect(outcome.inserted).toBeGreaterThan(0);

    const refreshed = sched.getScheduledSync(s.id)!;
    expect(refreshed.lastStatus).toBe("success");
    expect(refreshed.lastInserted).toBe(outcome.inserted);
    expect(refreshed.lastRunAt).not.toBeNull();
    expect(refreshed.lastError).toBeNull();

    const uploadCount = sqlite
      .prepare("SELECT COUNT(*) AS c FROM uploads WHERE model_id = ? AND filename LIKE ?")
      .get(modelId, "Zamanlanmış senkronizasyon:%") as { c: number };
    expect(uploadCount.c).toBeGreaterThan(0);
  });

  it("eksik boyut eslemesi (validation hatasi) last_status=failed ve last_error doldurur", async () => {
    const s = sched.createScheduledSync({
      name: "Hatalı Eşleme",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: { GLAccount: "ACCOUNT", AmountInCompanyCodeCurrency: "DEGER" }, // COSTCENTER eksik
      intervalMinutes: 60,
      createdBy: userId,
    });
    const outcome = await sched.runScheduledSync(s.id);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("COSTCENTER");

    const refreshed = sched.getScheduledSync(s.id)!;
    expect(refreshed.lastStatus).toBe("failed");
    expect(refreshed.lastInserted).toBeNull();
    expect(refreshed.lastError).toContain("COSTCENTER");
  });

  it("olmayan senkronizasyon id'si icin hata firlatir", async () => {
    await expect(sched.runScheduledSync(999999)).rejects.toThrow();
  });
});

describe("findDueScheduledSyncs / runDueScheduledSyncs", () => {
  it("hic calismamis aktif bir senkronizasyon her zaman vadesi gelmis sayilir", () => {
    const s = sched.createScheduledSync({
      name: "Vadesi Gelmiş (yeni)",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });
    const due = sched.findDueScheduledSyncs();
    expect(due.some((d) => d.id === s.id)).toBe(true);
  });

  it("pasif bir senkronizasyon vadesi gelmis sayilmaz", () => {
    const s = sched.createScheduledSync({
      name: "Pasif",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });
    sched.updateScheduledSync(s.id, { active: false });
    const due = sched.findDueScheduledSyncs();
    expect(due.some((d) => d.id === s.id)).toBe(false);
  });

  it("son calisma zamani interval icindeyse vadesi gelmemis sayilir", async () => {
    const s = sched.createScheduledSync({
      name: "Az Önce Çalıştı",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });
    await sched.runScheduledSync(s.id);
    const due = sched.findDueScheduledSyncs();
    expect(due.some((d) => d.id === s.id)).toBe(false);
  });

  it("son calisma zamani interval'i asmissa yeniden vadesi gelmis sayilir", async () => {
    const s = sched.createScheduledSync({
      name: "Interval Aşıldı",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 1,
      createdBy: userId,
    });
    await sched.runScheduledSync(s.id);
    // last_run_at'i gecmise cekerek 1 dakikalik interval'in asildigini simule et.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    sqlite.prepare("UPDATE scheduled_syncs SET last_run_at = ? WHERE id = ?").run(twoMinutesAgo, s.id);
    const due = sched.findDueScheduledSyncs();
    expect(due.some((d) => d.id === s.id)).toBe(true);
  });

  it("runDueScheduledSyncs sadece vadesi gelmis aktif senkronizasyonlari calistirir", async () => {
    const notDue = sched.createScheduledSync({
      name: "Henüz Vadesi Gelmedi",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 999999,
      createdBy: userId,
    });
    await sched.runScheduledSync(notDue.id); // calistir, artik vadesi gelmemis olacak

    const due = sched.createScheduledSync({
      name: "Vadesi Geldi (bulk)",
      connectorConfigId: sapMockConfigId,
      source: "C_GLACCOUNTBALANCE",
      modelId,
      mapping: GOOD_MAPPING,
      intervalMinutes: 60,
      createdBy: userId,
    });

    const outcomes = await sched.runDueScheduledSyncs();
    const ids = outcomes.map((o) => o.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notDue.id);
  });
});
