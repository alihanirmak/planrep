import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DimInfo } from "./model";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-facts-write-${process.pid}-${Date.now()}.db`
);

let upsertFacts: typeof import("./facts-write")["upsertFacts"];
let revertUpload: typeof import("./facts-write")["revertUpload"];
let sqlite: typeof import("./db")["sqlite"];

const dims: DimInfo[] = [
  { id: 1, code: "D1", name: "Dim1", type: "standard", slot: 1, members: [] },
  { id: 2, code: "D2", name: "Dim2", type: "standard", slot: 2, members: [] },
];

let modelId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  const factsWrite = await import("./facts-write");
  upsertFacts = factsWrite.upsertFacts;
  revertUpload = factsWrite.revertUpload;
  const db = await import("./db");
  sqlite = db.sqlite;

  modelId = Number(
    sqlite
      .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
      .run("FWTEST", "Facts Write Test", new Date().toISOString()).lastInsertRowid
  );
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

function newUpload(filename: string): number {
  return Number(
    sqlite
      .prepare("INSERT INTO uploads (model_id, filename, user_id, created_at) VALUES (?,?,?,?)")
      .run(modelId, filename, 1, new Date().toISOString()).lastInsertRowid
  );
}

function factCount(): number {
  return (sqlite.prepare("SELECT COUNT(*) c FROM facts WHERE model_id=?").get(modelId) as { c: number }).c;
}

function factValue(d1: string, d2: string): number | undefined {
  const row = sqlite
    .prepare("SELECT value FROM facts WHERE model_id=? AND d1=? AND d2=?")
    .get(modelId, d1, d2) as { value: number } | undefined;
  return row?.value;
}

describe("upsertFacts", () => {
  it("bos tabloya ilk upsert tum satirlari ekler, replaced_rows bos olur", () => {
    const uploadId = newUpload("f1.csv");
    const rows = Array.from({ length: 250 }, (_, i) => ({ coords: [`A${i}`, `B${i % 5}`], value: i }));
    upsertFacts(modelId, dims, rows, uploadId, new Date().toISOString());

    expect(factCount()).toBe(250);
    const replaced = JSON.parse(
      (sqlite.prepare("SELECT replaced_rows FROM uploads WHERE id=?").get(uploadId) as { replaced_rows: string })
        .replaced_rows
    );
    expect(replaced).toEqual([]);
  });

  it("ayni koordinatlara ikinci upsert eski degerleri ezer (satir sayisi artmaz)", () => {
    const uploadId = newUpload("f2.csv");
    const rows = Array.from({ length: 100 }, (_, i) => ({ coords: [`A${i}`, `B${i % 5}`], value: 1000 + i }));
    upsertFacts(modelId, dims, rows, uploadId, new Date().toISOString());

    expect(factCount()).toBe(250);
    expect(factValue("A5", "B0")).toBe(1005);

    const replaced: Array<{ coords: string[]; value: number }> = JSON.parse(
      (sqlite.prepare("SELECT replaced_rows FROM uploads WHERE id=?").get(uploadId) as { replaced_rows: string })
        .replaced_rows
    );
    expect(replaced).toHaveLength(100);
    const old = replaced.find((r) => r.coords[0] === "A5" && r.coords[1] === "B0");
    expect(old?.value).toBe(5);
  });

  it("ROWS_PER_INSERT (80) chunk sinirini asan buyuk toplu upsert dogru calisir", () => {
    const uploadId = newUpload("f3.csv");
    const rows = Array.from({ length: 777 }, (_, i) => ({ coords: [`C${i}`, `D${i}`], value: i * 2 }));
    upsertFacts(modelId, dims, rows, uploadId, new Date().toISOString());

    expect(factCount()).toBe(250 + 777);
    expect(factValue("C500", "D500")).toBe(1000);
  });
});

describe("revertUpload", () => {
  it("upload'in yazdigi satirlari siler ve ezdigi eski degerleri geri yukler", () => {
    const uploadA = newUpload("revert-a.csv");
    upsertFacts(modelId, dims, [{ coords: ["R1", "R2"], value: 42 }], uploadA, new Date().toISOString());
    expect(factValue("R1", "R2")).toBe(42);

    const uploadB = newUpload("revert-b.csv");
    upsertFacts(modelId, dims, [{ coords: ["R1", "R2"], value: 999 }], uploadB, new Date().toISOString());
    expect(factValue("R1", "R2")).toBe(999);

    const countBefore = factCount();
    const revertedCount = revertUpload(uploadB, modelId, dims);
    expect(revertedCount).toBe(1);
    expect(factCount()).toBe(countBefore);
    expect(factValue("R1", "R2")).toBe(42);

    const status = (
      sqlite.prepare("SELECT status FROM uploads WHERE id=?").get(uploadB) as { status: string }
    ).status;
    expect(status).toBe("reverted");
  });

  it("yeni (eskiden ezmeyen) satirlar icin revert sadece siler, hicbir sey geri yuklenmez", () => {
    const uploadId = newUpload("revert-new.csv");
    upsertFacts(modelId, dims, [{ coords: ["ONLYNEW1", "ONLYNEW2"], value: 7 }], uploadId, new Date().toISOString());
    expect(factValue("ONLYNEW1", "ONLYNEW2")).toBe(7);

    const reverted = revertUpload(uploadId, modelId, dims);
    expect(reverted).toBe(0);
    expect(factValue("ONLYNEW1", "ONLYNEW2")).toBeUndefined();
  });
});

describe("upsertFacts + workflow kilidi", () => {
  const lockDims: DimInfo[] = [
    {
      id: 10,
      code: "LD1",
      name: "LockDim1",
      type: "standard",
      slot: 1,
      members: [
        { id: 1, code: "LOCKED1", name: "Locked1", parentId: null, orderIdx: 0 },
        { id: 2, code: "FREE1", name: "Free1", parentId: null, orderIdx: 1 },
      ],
    },
    { id: 11, code: "LD2", name: "LockDim2", type: "standard", slot: 2, members: [] },
  ];
  let lockModelId: number;

  beforeAll(async () => {
    lockModelId = Number(
      sqlite
        .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
        .run("FWLOCK", "Facts Write Lock Test", new Date().toISOString()).lastInsertRowid
    );
    const workflow = await import("./workflow");
    const planner = Number(
      sqlite
        .prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)")
        .run("fwplanner@test.local", "Planner", "x", "planner", new Date().toISOString()).lastInsertRowid
    );
    let item = workflow.createWorkflowItem({
      modelId: lockModelId,
      name: "Kilit Testi",
      scopeFilters: { LD1: ["LOCKED1"] },
      ownerId: planner,
    });
    item = workflow.applyTransition(item, { action: "submit", from: "draft", to: "submitted" }, planner, null);
    item = workflow.applyTransition(item, { action: "review", from: "submitted", to: "in_review" }, planner, null);
    item = workflow.applyTransition(item, { action: "approve", from: "in_review", to: "approved" }, planner, null);
    workflow.applyTransition(item, { action: "lock", from: "approved", to: "locked" }, planner, null);
  });

  it("kilitli kapsamdaki koordinata upsert WorkflowLockError firlatir ve hicbir sey yazmaz", () => {
    const uploadId = newUpload("lock-attempt.csv");
    const before = (
      sqlite.prepare("SELECT COUNT(*) c FROM facts WHERE model_id=?").get(lockModelId) as { c: number }
    ).c;
    expect(() =>
      upsertFacts(
        lockModelId,
        lockDims,
        [{ coords: ["LOCKED1", "X"], value: 1 }],
        uploadId,
        new Date().toISOString()
      )
    ).toThrowError(/kilit/i);
    const after = (
      sqlite.prepare("SELECT COUNT(*) c FROM facts WHERE model_id=?").get(lockModelId) as { c: number }
    ).c;
    expect(after).toBe(before);
  });

  it("kilit kapsami disindaki koordinata upsert normal calisir", () => {
    const uploadId = newUpload("lock-free.csv");
    upsertFacts(lockModelId, lockDims, [{ coords: ["FREE1", "X"], value: 42 }], uploadId, new Date().toISOString());
    const row = sqlite
      .prepare("SELECT value FROM facts WHERE model_id=? AND d1=? AND d2=?")
      .get(lockModelId, "FREE1", "X") as { value: number } | undefined;
    expect(row?.value).toBe(42);
  });
});
