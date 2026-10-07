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
  it("dryRun=true hicbir sey yazmaz ama 'created' olarak onizler", () => {
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
    const results = da.runPlan(plan, ctx(), true);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM dimensions WHERE code = 'DEVREGION'").get();
    expect(row).toBeUndefined();
  });

  it("dryRun=false gercekten boyut+uyeleri yazar", () => {
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
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM dimensions WHERE code = 'DEVREGION'").get() as { id: number };
    expect(row).toBeDefined();
    const members = sqlite
      .prepare("SELECT code FROM dimension_members WHERE dimension_id = ?")
      .all(row.id) as Array<{ code: string }>;
    expect(members.map((m) => m.code).sort()).toEqual(["APAC", "EMEA"]);
  });

  it("ayni kodla ikinci kez calistirilinca 'exists' doner, yeniden olusturmaz", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "create_dimension", code: "DEVREGION", name: "Bölge", dimType: "standard", members: [] }],
    };
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("exists");
  });

  it("viewer rolu boyut olusturamaz", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "create_dimension", code: "DEVVIEW", name: "X", dimType: "standard", members: [] }],
    };
    const results = da.runPlan(plan, ctx("viewer"), false);
    expect(results[0].status).toBe("error");
    const row = sqlite.prepare("SELECT id FROM dimensions WHERE code = 'DEVVIEW'").get();
    expect(row).toBeUndefined();
  });
});

describe("runPlan — create_model", () => {
  it("var olan boyutlara referansla yeni model olusturur", () => {
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
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM models WHERE code = 'DEVSALES'").get() as { id: number };
    expect(row).toBeDefined();
    const dims = sqlite
      .prepare("SELECT dimension_id FROM model_dimensions WHERE model_id = ?")
      .all(row.id);
    expect(dims.length).toBe(1);
  });

  it("bulunmayan bir boyuta referans verirse hata doner, model olusturulmaz", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        { type: "create_model", code: "DEVFAIL", name: "X", description: null, dimensionCodes: ["YOKBOYUT"] },
      ],
    };
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("error");
    const row = sqlite.prepare("SELECT id FROM models WHERE code = 'DEVFAIL'").get();
    expect(row).toBeUndefined();
  });

  it("ayni planda ONCE olusturulan bir boyuta referans verebilir (ayni calistirma icinde)", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        { type: "create_dimension", code: "DEVTIME", name: "Zaman", dimType: "time", members: [] },
        { type: "create_model", code: "DEVSALES2", name: "Satış 2", description: null, dimensionCodes: ["DEVTIME"] },
      ],
    };
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    expect(results[1].status).toBe("created");
  });
});

describe("runPlan — create_measure", () => {
  it("MAX_MODEL_MEASURES siniri asilirsa hata doner", () => {
    const actions: import("./dev-actions").DevAction[] = [];
    for (let i = 0; i < 9; i++) {
      actions.push({ type: "create_measure", modelCode: "DEVSALES", code: `M${i}`, name: `Ölçü ${i}` });
    }
    const results = da.runPlan({ actions }, ctx(), false);
    expect(results.filter((r) => r.status === "created").length).toBe(8);
    expect(results[8].status).toBe("error");
    expect(results[8].message).toContain("en fazla");
  });

  it("viewer rolu olcu olusturamaz", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "create_measure", modelCode: "DEVSALES", code: "MVIEW", name: "X" }],
    };
    const results = da.runPlan(plan, ctx("viewer"), false);
    expect(results[0].status).toBe("error");
  });
});

describe("runPlan — create_report", () => {
  it("gecerli satir/sutun boyutlariyla rapor olusturur", () => {
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
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite.prepare("SELECT id FROM reports WHERE name = 'Test Rapor'").get();
    expect(row).toBeDefined();
  });

  it("modelin sahip olmadigi bir boyut verilirse hata doner", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        { type: "create_report", modelCode: "DEVSALES", name: "Kötü Rapor", rows: ["YOKBOYUT"], cols: ["DEVREGION"] },
      ],
    };
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("error");
  });
});

describe("runPlan — upload_facts", () => {
  it("coords ile verilen satirlari gercek facts tablosuna yazar", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [
        {
          type: "upload_facts",
          modelCode: "DEVSALES",
          rows: [{ coords: { DEVREGION: "EMEA" }, value: 100 }],
        },
      ],
    };
    const results = da.runPlan(plan, ctx(), false);
    expect(results[0].status).toBe("created");
    const row = sqlite
      .prepare(
        `SELECT value FROM facts f JOIN models m ON m.id = f.model_id WHERE m.code = 'DEVSALES' AND f.d1 = 'EMEA'`
      )
      .get() as { value: number } | undefined;
    expect(row?.value).toBe(100);
  });

  it("viewer rolu veri yazamaz", () => {
    const plan: import("./dev-actions").DevPlan = {
      actions: [{ type: "upload_facts", modelCode: "DEVSALES", rows: [{ coords: { DEVREGION: "APAC" }, value: 1 }] }],
    };
    const results = da.runPlan(plan, ctx("viewer"), false);
    expect(results[0].status).toBe("error");
  });
});
