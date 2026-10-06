import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-connector-configs-${process.pid}-${Date.now()}.db`
);

let cc: typeof import("./connector-configs");
let connectors: typeof import("./connectors");
let sqlite: typeof import("./db")["sqlite"];

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  delete process.env.SAP_ODATA_URL;
  delete process.env.SAP_USER;
  delete process.env.SAP_PASS;
  delete process.env.SAP_ODATA_ENTITIES;
  cc = await import("./connector-configs");
  connectors = await import("./connectors");
  const db = await import("./db");
  sqlite = db.sqlite;
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("seedConnectorConfigsFromEnv (module load side-effect)", () => {
  it("env degiskenleri yoksa sadece sap-mock config'i otomatik olusturur", () => {
    const configs = cc.listConnectorConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].type).toBe("sap-mock");
  });
});

describe("createConnectorConfig / getConnectorConfig / listConnectorConfigs", () => {
  it("yeni bir sap-odata config'i olusturup geri okunabilir", () => {
    const cfg = cc.createConnectorConfig({
      type: "sap-odata",
      name: "Test SAP",
      config: { url: "https://example.com", user: "u", pass: "p", entities: "E1,E2" },
    });
    expect(cfg.id).toBeGreaterThan(0);
    expect(cc.getConnectorConfig(cfg.id)).toEqual(cfg);
  });

  it("activeOnly filtresi sadece aktif kayitlari dondurur", () => {
    const cfg = cc.createConnectorConfig({ type: "sap-mock", name: "Pasif Test", config: {} });
    cc.updateConnectorConfig(cfg.id, { active: false });
    const active = cc.listConnectorConfigs({ activeOnly: true });
    expect(active.find((c) => c.id === cfg.id)).toBeUndefined();
    const all = cc.listConnectorConfigs();
    expect(all.find((c) => c.id === cfg.id)).toBeDefined();
  });
});

describe("updateConnectorConfig / deleteConnectorConfig", () => {
  it("name ve config kismi guncellenebilir", () => {
    const cfg = cc.createConnectorConfig({
      type: "sap-odata",
      name: "Guncellenecek",
      config: { url: "https://old.example.com", user: "u", pass: "p", entities: "" },
    });
    const updated = cc.updateConnectorConfig(cfg.id, {
      name: "Yeni Ad",
      config: { ...cfg.config, url: "https://new.example.com" },
    });
    expect(updated?.name).toBe("Yeni Ad");
    expect(updated?.config.url).toBe("https://new.example.com");
    expect(updated?.config.user).toBe("u"); // degismeyen alan korunur
  });

  it("deleteConnectorConfig kaydi siler", () => {
    const cfg = cc.createConnectorConfig({ type: "sap-mock", name: "Silinecek", config: {} });
    cc.deleteConnectorConfig(cfg.id);
    expect(cc.getConnectorConfig(cfg.id)).toBeNull();
  });
});

describe("lib/connectors — dinamik Connector uretimi", () => {
  it("listConnectorInstances aktif config'lerden canli Connector uretir", () => {
    const instances = connectors.listConnectorInstances();
    expect(instances.length).toBeGreaterThan(0);
    expect(instances.every((i) => typeof i.connector.fetchRows === "function")).toBe(true);
  });

  it("getConnectorInstance belirli bir config id'si icin dogru turden Connector doner", () => {
    const cfg = cc.createConnectorConfig({
      type: "sap-odata",
      name: "Instance Test",
      config: { url: "https://example.com", user: "u", pass: "p", entities: "E1" },
    });
    const inst = connectors.getConnectorInstance(cfg.id);
    expect(inst).not.toBeNull();
    expect(inst?.connector.id).toBe("sap-odata");
    expect(inst?.name).toBe("Instance Test");
  });

  it("pasif config icin getConnectorInstance null doner", () => {
    const cfg = cc.createConnectorConfig({ type: "sap-mock", name: "Pasif Instance", config: {} });
    cc.updateConnectorConfig(cfg.id, { active: false });
    expect(connectors.getConnectorInstance(cfg.id)).toBeNull();
  });

  it("var olmayan config id'si icin getConnectorInstance null doner", () => {
    expect(connectors.getConnectorInstance(999999)).toBeNull();
  });

  it("sap-mock connector her zaman baglanir ve kaynak dondurur", async () => {
    const cfg = cc.listConnectorConfigs().find((c) => c.type === "sap-mock")!;
    const inst = connectors.getConnectorInstance(cfg.id)!;
    expect(await inst.connector.test()).toBeNull();
    const sources = await inst.connector.listSources();
    expect(sources.length).toBeGreaterThan(0);
  });

  it("sap-odata connector eksik config ile anlamli hata mesaji doner (test())", async () => {
    const cfg = cc.createConnectorConfig({
      type: "sap-odata",
      name: "Eksik Config",
      config: {},
    });
    const inst = connectors.getConnectorInstance(cfg.id)!;
    const status = await inst.connector.test();
    expect(status).toMatch(/URL/i);
  });

  it("CONNECTOR_TYPES iki turu de icerir ve configFields metadata'si dogru", () => {
    expect(connectors.CONNECTOR_TYPES.map((t) => t.type).sort()).toEqual(["sap-mock", "sap-odata"]);
    const odata = connectors.getConnectorType("sap-odata");
    expect(odata?.configFields.map((f) => f.key).sort()).toEqual(["entities", "pass", "url", "user"]);
    const mock = connectors.getConnectorType("sap-mock");
    expect(mock?.configFields).toEqual([]);
  });
});
