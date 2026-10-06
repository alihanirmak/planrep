import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-notifications-${process.pid}-${Date.now()}.db`
);

let notif: typeof import("./notifications");
let sqlite: typeof import("./db")["sqlite"];

let aliceId: number;
let bobId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  notif = await import("./notifications");
  const db = await import("./db");
  sqlite = db.sqlite;

  const now = new Date().toISOString();
  aliceId = Number(
    sqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, locale, created_at) VALUES (?,?,?,?,?,?)")
      .run("alice@example.com", "Alice Yılmaz", "hash", "planner", "tr", now).lastInsertRowid
  );
  bobId = Number(
    sqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, locale, created_at) VALUES (?,?,?,?,?,?)")
      .run("bob@example.com", "Bob Demir", "hash", "planner", "en", now).lastInsertRowid
  );
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("createNotification / listNotifications / countUnreadNotifications", () => {
  it("bildirim olusturur ve listede gorunur", () => {
    const n = notif.createNotification({
      userId: aliceId,
      type: "comment_new",
      params: { userName: "Bob", entityName: "Q1 Raporu" },
      link: "/reports",
    });
    expect(n.userId).toBe(aliceId);
    expect(n.isRead).toBe(false);

    const list = notif.listNotifications(aliceId);
    expect(list.some((x) => x.id === n.id)).toBe(true);
  });

  it("unreadOnly filtresi sadece okunmamislari dondurur", () => {
    const n = notif.createNotification({ userId: bobId, type: "comment_new", params: {} });
    expect(notif.listNotifications(bobId, { unreadOnly: true }).some((x) => x.id === n.id)).toBe(true);
    notif.markNotificationRead(n.id, bobId);
    expect(notif.listNotifications(bobId, { unreadOnly: true }).some((x) => x.id === n.id)).toBe(false);
  });

  it("countUnreadNotifications dogru sayar", () => {
    const before = notif.countUnreadNotifications(aliceId);
    notif.createNotification({ userId: aliceId, type: "workflow_approved", params: {} });
    expect(notif.countUnreadNotifications(aliceId)).toBe(before + 1);
  });
});

describe("createNotifications (bulk)", () => {
  it("birden fazla kullaniciya ayni bildirimi gonderir", () => {
    const beforeAlice = notif.countUnreadNotifications(aliceId);
    const beforeBob = notif.countUnreadNotifications(bobId);
    notif.createNotifications([aliceId, bobId], "workflow_review_needed", { workflowName: "Q2 Plan" }, "/workflow/1");
    expect(notif.countUnreadNotifications(aliceId)).toBe(beforeAlice + 1);
    expect(notif.countUnreadNotifications(bobId)).toBe(beforeBob + 1);
  });

  it("bos userIds listesi hicbir sey olusturmaz", () => {
    const before = notif.countUnreadNotifications(aliceId);
    notif.createNotifications([], "comment_new", {});
    expect(notif.countUnreadNotifications(aliceId)).toBe(before);
  });

  it("tekrarlanan userId'leri tekillestirir (tek bildirim)", () => {
    const before = notif.listNotifications(aliceId).length;
    notif.createNotifications([aliceId, aliceId], "comment_new", {});
    expect(notif.listNotifications(aliceId).length).toBe(before + 1);
  });
});

describe("markNotificationRead / markAllNotificationsRead", () => {
  it("baska kullaniciya ait bildirimi okundu yapmaya calisirsa false doner", () => {
    const n = notif.createNotification({ userId: aliceId, type: "comment_new", params: {} });
    expect(notif.markNotificationRead(n.id, bobId)).toBe(false);
    expect(notif.markNotificationRead(n.id, aliceId)).toBe(true);
  });

  it("olmayan bildirim id'si icin false doner", () => {
    expect(notif.markNotificationRead(999999, aliceId)).toBe(false);
  });

  it("markAllNotificationsRead tum okunmamislari okur ve sayiyi doner", () => {
    notif.createNotification({ userId: bobId, type: "comment_new", params: {} });
    notif.createNotification({ userId: bobId, type: "workflow_approved", params: {} });
    const updated = notif.markAllNotificationsRead(bobId);
    expect(updated).toBeGreaterThan(0);
    expect(notif.countUnreadNotifications(bobId)).toBe(0);
  });
});

describe("resolveMentionedUserIds", () => {
  it("isim bazli mention'i (bosluksuz, kucuk harf) cozer", () => {
    expect(notif.resolveMentionedUserIds("Merhaba @aliceyılmaz, bakar mısın?")).toEqual([aliceId]);
  });

  it("e-posta local-part bazli mention'i cozer", () => {
    expect(notif.resolveMentionedUserIds("cc @bob lütfen")).toEqual([bobId]);
  });

  it("birden fazla mention'i cozer ve tekillestirir", () => {
    const ids = notif.resolveMentionedUserIds("@bob ve @aliceyılmaz ve tekrar @bob");
    expect(new Set(ids)).toEqual(new Set([aliceId, bobId]));
  });

  it("eslesmeyen mention icin bos liste doner", () => {
    expect(notif.resolveMentionedUserIds("@olmayankullanici")).toEqual([]);
  });

  it("hic @ yoksa bos liste doner", () => {
    expect(notif.resolveMentionedUserIds("sade bir yorum metni")).toEqual([]);
  });
});

describe("renderNotification", () => {
  it("tr locale'de notif.* anahtarini params ile doldurur", () => {
    const n = notif.createNotification({
      userId: aliceId,
      type: "workflow_approved",
      params: { workflowName: "Q1 Plan" },
    });
    expect(notif.renderNotification(n, "tr")).toBe('"Q1 Plan" iş akışı onaylandı');
  });

  it("en locale'de notif.* anahtarini params ile doldurur", () => {
    const n = notif.createNotification({
      userId: aliceId,
      type: "workflow_approved",
      params: { workflowName: "Q1 Plan" },
    });
    expect(notif.renderNotification(n, "en")).toBe('Workflow "Q1 Plan" was approved');
  });
});
