import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../../data/.vitest-dev-actions-${process.pid}-${Date.now()}.db`
);

let da: typeof import("./dev-actions");
let sqlite: typeof import("../db")["sqlite"];

const TENANT_ID = 1;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  // Testler host makinenin GERCEKTEN axet-code CLI'ye sahip olup olmamasindan
  // bagimsiz, deterministik olmali — axet'in mevcut OLMADIGI yoldaki hata
  // davranisini test etmek icin KASITLI OLARAK devre disi birakiliyor.
  process.env.AXET_DISABLE = "1";
  da = await import("./dev-actions");
  const db = await import("../db");
  sqlite = db.sqlite;
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

function ctx(role: "admin" | "planner" | "viewer" = "planner") {
  return { tenantId: TENANT_ID, userId: 1, role };
}

describe("runPlan — create_dimension", () => {
  it("dryRun=true hicbir sey yazmaz ama 'created' olarak onizler", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        {
          type: "create_dimension",
          code: "DEVREGION",
          name: "Bölge",
          dimType: "standard",
          members: [{ code: "EMEA", name: "EMEA" }],
        },
      ],
    };
    const results = await da.runPlan(plan, ctx(), true);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM dimensions WHERE code = 'DEVREGION'").get();
    expect(row).toBeUndefined();
  });

  it("dryRun=false gercekten boyut+uyeleri yazar", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        {
          type: "create_dimension",
          code: "DEVREGION",
          name: "Bölge",
          dimType: "standard",
          members: [
            { code: "EMEA", name: "EMEA" },
            { code: "APAC", name: "APAC" },
          ],
        },
      ],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM dimensions WHERE code = 'DEVREGION'").get() as { id: number };
    expect(row).toBeDefined();
    const members = sqlite
      .prepare("SELECT code FROM dimension_members WHERE dimension_id = ?")
      .all(row.id) as Array<{ code: string }>;
    expect(members.map((m) => m.code).sort()).toEqual(["APAC", "EMEA"]);
  });

  it("ayni kodla ikinci kez calistirilinca 'exists' doner, yeniden olusturmaz", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "create_dimension", code: "DEVREGION", name: "Bölge", dimType: "standard", members: [] }],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("exists");
  });

  it("viewer rolu boyut olusturamaz", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "create_dimension", code: "DEVVIEW", name: "X", dimType: "standard", members: [] }],
    };
    const results = await da.runPlan(plan, ctx("viewer"), false);
    expect(results[0].status).toBe("error");
    const row = sqlite.prepare("SELECT id FROM dimensions WHERE code = 'DEVVIEW'").get();
    expect(row).toBeUndefined();
  });
});

describe("runPlan — create_model", () => {
  it("var olan boyutlara referansla yeni model olusturur", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        {
          type: "create_model",
          code: "DEVSALES",
          name: "Satış",
          description: null,
          dimensionCodes: ["DEVREGION"],
        },
      ],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM models WHERE code = 'DEVSALES'").get() as { id: number };
    expect(row).toBeDefined();
    const dims = sqlite
      .prepare("SELECT dimension_id FROM model_dimensions WHERE model_id = ?")
      .all(row.id);
    expect(dims.length).toBe(1);
  });

  it("bulunmayan bir boyuta referans verirse hata doner, model olusturulmaz", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        { type: "create_model", code: "DEVFAIL", name: "X", description: null, dimensionCodes: ["YOKBOYUT"] },
      ],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("error");
    const row = sqlite.prepare("SELECT id FROM models WHERE code = 'DEVFAIL'").get();
    expect(row).toBeUndefined();
  });

  it("ayni planda ONCE olusturulan bir boyuta referans verebilir (ayni calistirma icinde)", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        { type: "create_dimension", code: "DEVTIME", name: "Zaman", dimType: "time", members: [] },
        { type: "create_model", code: "DEVSALES2", name: "Satış 2", description: null, dimensionCodes: ["DEVTIME"] },
      ],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    expect(results[1].status).toBe("created");
  });
});

describe("runPlan — create_measure", () => {
  it("MAX_MODEL_MEASURES siniri asilirsa hata doner", async () => {
    const actions: import("./dev-actions").DevAction[] = [];
    for (let i = 0; i < 9; i++) {
      actions.push({ type: "create_measure", modelCode: "DEVSALES", code: `M${i}`, name: `Ölçü ${i}` });
    }
    const results = await da.runPlan({ actions }, ctx(), false);
    expect(results.filter((r) => r.status === "created").length).toBe(8);
    expect(results[8].status).toBe("error");
    expect(results[8].message).toContain("en fazla");
  });

  it("viewer rolu olcu olusturamaz", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "create_measure", modelCode: "DEVSALES", code: "MVIEW", name: "X" }],
    };
    const results = await da.runPlan(plan, ctx("viewer"), false);
    expect(results[0].status).toBe("error");
  });
});

describe("runPlan — create_report", () => {
  it("gecerli satir/sutun boyutlariyla rapor olusturur", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        {
          type: "create_report",
          modelCode: "DEVSALES",
          name: "Test Rapor",
          rows: ["DEVREGION"],
          cols: ["DEVREGION"],
        },
      ],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM reports WHERE name = 'Test Rapor'").get();
    expect(row).toBeDefined();
  });

  it("modelin sahip olmadigi bir boyut verilirse hata doner", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        { type: "create_report", modelCode: "DEVSALES", name: "Kötü Rapor", rows: ["YOKBOYUT"], cols: ["DEVREGION"] },
      ],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("error");
  });
});

describe("runPlan — upload_facts", () => {
  it("coords ile verilen satirlari gercek facts tablosuna yazar", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        {
          type: "upload_facts",
          modelCode: "DEVSALES",
          rows: [{ coords: { DEVREGION: "EMEA" }, value: 100 }],
        },
      ],
    };
    const results = await da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite
      .prepare(
        `SELECT value FROM facts f JOIN models m ON m.id = f.model_id WHERE m.code = 'DEVSALES' AND f.d1 = 'EMEA'`
      )
      .get() as { value: number } | undefined;
    expect(row?.value).toBe(100);
  });

  it("viewer rolu veri yazamaz", async () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "upload_facts", modelCode: "DEVSALES", rows: [{ coords: { DEVREGION: "APAC" }, value: 1 }] }],
    };
    const results = await da.runPlan(plan, ctx("viewer"), false);
    expect(results[0].status).toBe("error");
  });
});

describe("runPlan — analyze_anomalies / forecast_measure / update_report_add_comparison / create_comment", () => {
  let fcModelId: number;
  let versionDimId: number;
  let timeDimId: number;
  let reportId: number;

  beforeAll(() => {
    const now = new Date().toISOString();
    versionDimId = Number(
      sqlite
        .prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)")
        .run("FCVER", "Versiyon", "version").lastInsertRowid
    );
    timeDimId = Number(
      sqlite
        .prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)")
        .run("FCTIME", "Zaman", "time").lastInsertRowid
    );
    const insMem = sqlite.prepare(
      "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
    );
    insMem.run(versionDimId, "ACTUAL", "Gerçekleşen", null, 0);
    insMem.run(timeDimId, "2026-01", "Ocak 2026", null, 0);
    insMem.run(timeDimId, "2026-02", "Şubat 2026", null, 1);
    insMem.run(timeDimId, "2026-03", "Mart 2026", null, 2);

    fcModelId = Number(
      sqlite
        .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
        .run("FCMODEL", "Forecast Model", now).lastInsertRowid
    );
    sqlite
      .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)")
      .run(fcModelId, versionDimId, 1);
    sqlite
      .prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)")
      .run(fcModelId, timeDimId, 2);
    sqlite
      .prepare("INSERT INTO facts (model_id, d1, d2, value, upload_id, updated_at) VALUES (?,?,?,?,NULL,?)")
      .run(fcModelId, "ACTUAL", "2026-01", 100, now);
    sqlite
      .prepare("INSERT INTO facts (model_id, d1, d2, value, upload_id, updated_at) VALUES (?,?,?,?,NULL,?)")
      .run(fcModelId, "ACTUAL", "2026-02", 110, now);

    reportId = Number(
      sqlite
        .prepare(
          "INSERT INTO reports (tenant_id, name, owner_id, model_id, definition, shared, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,?,1)"
        )
        .run(
          TENANT_ID,
          "FC Rapor",
          1,
          fcModelId,
          JSON.stringify({
            version: 2,
            modelId: fcModelId,
            rows: ["FCVER"],
            cols: ["FCTIME"],
            filters: {},
            calcColumns: [],
            calcRows: [],
            condRules: [],
            options: { hideZero: false, subtotals: true, valueMode: "abs", scale: 1, decimals: 0, topN: null, sort: null },
          }),
          0,
          now,
          now
        ).lastInsertRowid
    );
  });

  describe("analyze_anomalies", () => {
    it("model bulunamazsa hata doner", async () => {
      const results = await da.runPlan(
        { actions: [{ type: "analyze_anomalies", modelCode: "YOK", rowDim: "FCVER", colDim: "FCTIME" }] },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
    });

    it("gecersiz rowDim/colDim icin hata doner", async () => {
      const results = await da.runPlan(
        { actions: [{ type: "analyze_anomalies", modelCode: "FCMODEL", rowDim: "YOKBOYUT", colDim: "FCTIME" }] },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
    });

    it("axet mevcut degilken (test ortaminda beklenen durum) hata doner", async () => {
      const results = await da.runPlan(
        { actions: [{ type: "analyze_anomalies", modelCode: "FCMODEL", rowDim: "FCVER", colDim: "FCTIME" }] },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("axet");
    });
  });

  describe("forecast_measure", () => {
    it("viewer rolu tahmin yazamaz", async () => {
      const results = await da.runPlan(
        {
          actions: [
            {
              type: "forecast_measure",
              modelCode: "FCMODEL",
              timeDim: "FCTIME",
              sourceVersionCode: "ACTUAL",
              targetVersionCode: "FORECAST",
              targetVersionName: "Tahmin",
              periods: 1,
            },
          ],
        },
        ctx("viewer"),
        false
      );
      expect(results[0].status).toBe("error");
    });

    it("kaynak versiyon bulunamazsa hata doner", async () => {
      const results = await da.runPlan(
        {
          actions: [
            {
              type: "forecast_measure",
              modelCode: "FCMODEL",
              timeDim: "FCTIME",
              sourceVersionCode: "YOKVERSIYON",
              targetVersionCode: "FORECAST",
              targetVersionName: "Tahmin",
              periods: 1,
            },
          ],
        },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("Kaynak versiyon");
    });

    it("hedef versiyon kaynakla ayniysa hata doner", async () => {
      const results = await da.runPlan(
        {
          actions: [
            {
              type: "forecast_measure",
              modelCode: "FCMODEL",
              timeDim: "FCTIME",
              sourceVersionCode: "ACTUAL",
              targetVersionCode: "ACTUAL",
              targetVersionName: "X",
              periods: 1,
            },
          ],
        },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("farklı olmalı");
    });

    it("axet mevcut degilken (gecerli senaryoda) hata doner", async () => {
      const results = await da.runPlan(
        {
          actions: [
            {
              type: "forecast_measure",
              modelCode: "FCMODEL",
              timeDim: "FCTIME",
              sourceVersionCode: "ACTUAL",
              targetVersionCode: "FORECAST",
              targetVersionName: "Tahmin",
              periods: 1,
            },
          ],
        },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("axet");
      // Henuz hicbir sey yazilmamis olmali (FORECAST versiyonu olusturulmadi)
      const row = sqlite
        .prepare("SELECT id FROM dimension_members WHERE dimension_id = ? AND code = 'FORECAST'")
        .get(versionDimId);
      expect(row).toBeUndefined();
    });
  });

  describe("update_report_add_comparison", () => {
    it("rapor bulunamazsa hata doner", async () => {
      const results = await da.runPlan(
        { actions: [{ type: "update_report_add_comparison", reportName: "Yok Rapor", versionCodes: ["ACTUAL"] }] },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
    });

    it("gecersiz versiyon kodu icin hata doner", async () => {
      const results = await da.runPlan(
        { actions: [{ type: "update_report_add_comparison", reportName: "FC Rapor", versionCodes: ["YOKVERSIYON"] }] },
        ctx(),
        true
      );
      expect(results[0].status).toBe("error");
    });

    it("dryRun=false gercekten rapor tanimini guncelliyor (filters[VERSION] genislir)", async () => {
      const insMem = sqlite.prepare(
        "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
      );
      insMem.run(versionDimId, "BUDGET", "Bütçe", null, 1);
      const results = await da.runPlan(
        { actions: [{ type: "update_report_add_comparison", reportName: "FC Rapor", versionCodes: ["BUDGET"] }] },
        ctx(),
        false
      );
      expect(results[0].status).toBe("created");
      const row = sqlite.prepare("SELECT definition FROM reports WHERE id = ?").get(reportId) as { definition: string };
      const def = JSON.parse(row.definition);
      expect(def.filters.FCVER).toContain("BUDGET");
    });

    it("sahibi olmayan ama rapora erisimi olan (shared) bir kullanici guncelleyemez", async () => {
      // Gorunurluk (shared=1) ile yazma yetkisi (sadece sahip) birbirinden
      // AYRI kurallardir — bu testte once rapor paylasilir hale getiriliyor
      // ki findReportByName onu bulsun, ama owner_id hala farkli kaldigindan
      // guncelleme REDDEDILMELI (REST /api/reports/[id] PUT ile AYNI kural).
      sqlite.prepare("UPDATE reports SET shared = 1 WHERE id = ?").run(reportId);
      const results = await da.runPlan(
        { actions: [{ type: "update_report_add_comparison", reportName: "FC Rapor", versionCodes: ["ACTUAL"] }] },
        { tenantId: TENANT_ID, userId: 999, role: "admin" },
        false
      );
      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("sahibi değilsiniz");
    });
  });

  describe("create_comment", () => {
    it("rapor bulunamazsa hata doner", async () => {
      const results = await da.runPlan(
        { actions: [{ type: "create_comment", reportName: "Yok Rapor", target: "report", text: "test" }] },
        ctx(),
        false
      );
      expect(results[0].status).toBe("error");
    });

    it("rapor seviyesinde yorum eklenebilir (apply)", async () => {
      const results = await da.runPlan(
        { actions: [{ type: "create_comment", reportName: "FC Rapor", target: "report", text: "AI yorumu" }] },
        ctx(),
        false
      );
      expect(results[0].status).toBe("created");
      const row = sqlite
        .prepare("SELECT text FROM comments WHERE entity_type='report' AND entity_id=? AND cell_key IS NULL")
        .get(String(reportId)) as { text: string } | undefined;
      expect(row?.text).toBe("AI yorumu");
    });

    it("hucre yorumu admin olmayan rol icin reddedilir", async () => {
      const results = await da.runPlan(
        {
          actions: [
            { type: "create_comment", reportName: "FC Rapor", target: "cell", cellRowCode: "ACTUAL", text: "x" },
          ],
        },
        ctx("planner"),
        false
      );
      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("admin");
    });

    it("hucre yorumu admin rolu icin kabul edilir", async () => {
      const results = await da.runPlan(
        {
          actions: [
            { type: "create_comment", reportName: "FC Rapor", target: "cell", cellRowCode: "ACTUAL", cellColCode: "2026-01", text: "anomali" },
          ],
        },
        ctx("admin"),
        false
      );
      expect(results[0].status).toBe("created");
      const row = sqlite
        .prepare("SELECT text FROM comments WHERE entity_type='cell' AND cell_key = 'ACTUAL|2026-01'")
        .get() as { text: string } | undefined;
      expect(row?.text).toBe("anomali");
    });
  });
});
