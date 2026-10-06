import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DimInfo } from "./model";
import type { SessionUser } from "./session";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-workflow-${process.pid}-${Date.now()}.db`
);

let wf: typeof import("./workflow");
let sqlite: typeof import("./db")["sqlite"];

let modelId: number;
let lockModelId: number;
let overlapModelId: number;
let ownerId: number;
let otherId: number;
let adminId: number;

const dims: DimInfo[] = [
  {
    id: 1,
    code: "CC",
    name: "Masraf Yeri",
    type: "standard",
    slot: 1,
    members: [
      { id: 1, code: "CC_ALL", name: "Tum", parentId: null, orderIdx: 0 },
      { id: 2, code: "CC100", name: "Satis", parentId: 1, orderIdx: 1 },
      { id: 3, code: "CC200", name: "Pazarlama", parentId: 1, orderIdx: 2 },
    ],
  },
  {
    id: 2,
    code: "VER",
    name: "Versiyon",
    type: "version",
    slot: 2,
    members: [
      { id: 10, code: "BUDGET", name: "Bütçe", parentId: null, orderIdx: 0 },
      { id: 11, code: "ACTUAL", name: "Gerçekleşen", parentId: null, orderIdx: 1 },
    ],
  },
];

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  wf = await import("./workflow");
  const db = await import("./db");
  sqlite = db.sqlite;

  const now = new Date().toISOString();
  modelId = Number(
    sqlite.prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)").run("WFTEST", "WF Test", now)
      .lastInsertRowid
  );
  lockModelId = Number(
    sqlite
      .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
      .run("WFTEST_LOCK", "WF Lock Test", now).lastInsertRowid
  );
  overlapModelId = Number(
    sqlite
      .prepare("INSERT INTO models (code, name, created_at) VALUES (?,?,?)")
      .run("WFTEST_OVERLAP", "WF Overlap Test", now).lastInsertRowid
  );
  ownerId = Number(
    sqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)")
      .run("owner@wf.local", "Owner", "x", "planner", now).lastInsertRowid
  );
  otherId = Number(
    sqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)")
      .run("other@wf.local", "Other", "x", "planner", now).lastInsertRowid
  );
  adminId = Number(
    sqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)")
      .run("admin@wf.local", "Admin", "x", "admin", now).lastInsertRowid
  );
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

function session(id: number, role: SessionUser["role"]): { id: number; role: SessionUser["role"] } {
  return { id, role };
}

describe("createWorkflowItem / getWorkflowItem", () => {
  it("draft durumunda olusturur ve geri okunabilir", () => {
    const item = wf.createWorkflowItem({
      tenantId: 1,
      modelId,
      name: "2026 Bütçe - Satış",
      scopeFilters: { CC: ["CC100"], VER: ["BUDGET"] },
      ownerId,
    });
    expect(item.status).toBe("draft");
    expect(item.scopeFilters).toEqual({ CC: ["CC100"], VER: ["BUDGET"] });
    expect(wf.getWorkflowItem(item.id)).toEqual(item);
  });
});

describe("canTransition — durum makinesi ve yetki", () => {
  it("draft -> submitted sahibi tarafindan yapilabilir", () => {
    const item = wf.createWorkflowItem({ tenantId: 1, modelId, name: "A", scopeFilters: {}, ownerId });
    const check = wf.canTransition(item, "submit", session(ownerId, "planner"));
    expect(check.ok).toBe(true);
  });

  it("draft -> submitted sahibi olmayan planner tarafindan yapilamaz (forbidden)", () => {
    const item = wf.createWorkflowItem({ tenantId: 1, modelId, name: "B", scopeFilters: {}, ownerId });
    const check = wf.canTransition(item, "submit", session(otherId, "planner"));
    expect(check).toEqual({ ok: false, error: "forbidden" });
  });

  it("admin baskasinin draft'ini da submit edebilir", () => {
    const item = wf.createWorkflowItem({ tenantId: 1, modelId, name: "C", scopeFilters: {}, ownerId });
    const check = wf.canTransition(item, "submit", session(adminId, "admin"));
    expect(check.ok).toBe(true);
  });

  it("gecersiz gecis (draft -> approve) invalid_transition doner", () => {
    const item = wf.createWorkflowItem({ tenantId: 1, modelId, name: "D", scopeFilters: {}, ownerId });
    const check = wf.canTransition(item, "approve", session(adminId, "admin"));
    expect(check).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("review/approve islemleri planner tarafindan yapilamaz (forbidden)", () => {
    const item = wf.applyTransition(
      wf.createWorkflowItem({ tenantId: 1, modelId, name: "E", scopeFilters: {}, ownerId }),
      { action: "submit", from: "draft", to: "submitted" },
      ownerId,
      null
    );
    const check = wf.canTransition(item, "review", session(ownerId, "planner"));
    expect(check).toEqual({ ok: false, error: "forbidden" });
  });

  it("atanmis approver, review/approve yapabilir (admin olmasa da)", () => {
    const base = wf.createWorkflowItem({ tenantId: 1, modelId, name: "F", scopeFilters: {}, ownerId, approverId: otherId });
    const submitted = wf.applyTransition(
      base,
      { action: "submit", from: "draft", to: "submitted" },
      ownerId,
      null
    );
    const check = wf.canTransition(submitted, "review", session(otherId, "planner"));
    expect(check.ok).toBe(true);
  });

  it("reject islemi yorum (comment) gerektirir", () => {
    const submitted = wf.applyTransition(
      wf.createWorkflowItem({ tenantId: 1, modelId, name: "G", scopeFilters: {}, ownerId }),
      { action: "submit", from: "draft", to: "submitted" },
      ownerId,
      null
    );
    const withoutComment = wf.canTransition(submitted, "reject", session(adminId, "admin"), "");
    expect(withoutComment).toEqual({ ok: false, error: "comment_required" });
    const withComment = wf.canTransition(submitted, "reject", session(adminId, "admin"), "eksik veri");
    expect(withComment.ok).toBe(true);
  });
});

describe("applyTransition — tam dongu + history", () => {
  it("draft -> submitted -> in_review -> approved -> locked zincirini tasiyip history'ye yazar", () => {
    let item = wf.createWorkflowItem({ tenantId: 1, modelId, name: "Full Cycle", scopeFilters: { CC: ["CC100"] }, ownerId });

    item = wf.applyTransition(item, { action: "submit", from: "draft", to: "submitted" }, ownerId, null);
    expect(item.status).toBe("submitted");
    expect(item.submittedAt).not.toBeNull();

    item = wf.applyTransition(item, { action: "review", from: "submitted", to: "in_review" }, adminId, null);
    expect(item.status).toBe("in_review");
    expect(item.reviewedAt).not.toBeNull();

    item = wf.applyTransition(item, { action: "approve", from: "in_review", to: "approved" }, adminId, "ok");
    expect(item.status).toBe("approved");
    expect(item.approvedAt).not.toBeNull();

    item = wf.applyTransition(item, { action: "lock", from: "approved", to: "locked" }, adminId, null);
    expect(item.status).toBe("locked");
    expect(item.lockedAt).not.toBeNull();

    const history = wf.getWorkflowHistory(item.id);
    expect(history.map((h) => h.toStatus)).toEqual(["submitted", "in_review", "approved", "locked"]);
    expect(history[2].comment).toBe("ok");
  });
});

describe("findBlockingLock — tek koordinat kilit kontrolu", () => {
  it("kilitli kapsamin icindeki koordinati bloke eder, disindakini bloke etmez", () => {
    let item = wf.createWorkflowItem({
      tenantId: 1,
      modelId: lockModelId,
      name: "Lock Test",
      scopeFilters: { CC: ["CC100"], VER: ["BUDGET"] },
      ownerId,
    });
    item = wf.applyTransition(item, { action: "submit", from: "draft", to: "submitted" }, ownerId, null);
    item = wf.applyTransition(item, { action: "review", from: "submitted", to: "in_review" }, adminId, null);
    item = wf.applyTransition(item, { action: "approve", from: "in_review", to: "approved" }, adminId, null);
    item = wf.applyTransition(item, { action: "lock", from: "approved", to: "locked" }, adminId, null);

    const inside = wf.findBlockingLock(lockModelId, dims, { CC: "CC100", VER: "BUDGET" });
    expect(inside?.id).toBe(item.id);

    const outsideByCc = wf.findBlockingLock(lockModelId, dims, { CC: "CC200", VER: "BUDGET" });
    expect(outsideByCc).toBeNull();

    const outsideByVer = wf.findBlockingLock(lockModelId, dims, { CC: "CC100", VER: "ACTUAL" });
    expect(outsideByVer).toBeNull();
  });

  it("kisit tanimlanmayan boyutlar icin her deger eslesir (wildcard)", () => {
    let item = wf.createWorkflowItem({
      tenantId: 1,
      modelId: lockModelId,
      name: "Lock Wildcard",
      scopeFilters: { VER: ["BUDGET"] }, // CC icin kisit yok -> her CC eslesir
      ownerId,
    });
    item = wf.applyTransition(item, { action: "submit", from: "draft", to: "submitted" }, ownerId, null);
    item = wf.applyTransition(item, { action: "review", from: "submitted", to: "in_review" }, adminId, null);
    item = wf.applyTransition(item, { action: "approve", from: "in_review", to: "approved" }, adminId, null);
    item = wf.applyTransition(item, { action: "lock", from: "approved", to: "locked" }, adminId, null);

    expect(wf.findBlockingLock(lockModelId, dims, { CC: "CC200", VER: "BUDGET" })?.id).toBe(item.id);
    expect(wf.findBlockingLock(lockModelId, dims, { CC: "CC200", VER: "ACTUAL" })).toBeNull();
  });
});

describe("findBlockingLockForFilters — toplu islem kesisim kontrolu", () => {
  it("filtre kilitli kapsamla kesisiyorsa bloke eder", () => {
    let item = wf.createWorkflowItem({
      tenantId: 1,
      modelId: overlapModelId,
      name: "Lock Overlap",
      scopeFilters: { CC: ["CC_ALL"] },
      ownerId,
    });
    item = wf.applyTransition(item, { action: "submit", from: "draft", to: "submitted" }, ownerId, null);
    item = wf.applyTransition(item, { action: "review", from: "submitted", to: "in_review" }, adminId, null);
    item = wf.applyTransition(item, { action: "approve", from: "in_review", to: "approved" }, adminId, null);
    item = wf.applyTransition(item, { action: "lock", from: "approved", to: "locked" }, adminId, null);

    expect(wf.findBlockingLockForFilters(overlapModelId, dims, { CC: ["CC100"] })?.id).toBe(item.id);
    expect(wf.findBlockingLockForFilters(overlapModelId, dims, {})?.id).toBe(item.id);
  });
});
