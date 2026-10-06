import { sqlite } from "./db";
import type { NotificationType, Notification } from "./notifications-shared";

export type { NotificationType, Notification } from "./notifications-shared";
export { renderNotification } from "./notifications-shared";

type Row = {
  id: number;
  user_id: number;
  type: NotificationType;
  params: string;
  link: string | null;
  is_read: number;
  created_at: string;
};

function mapRow(r: Row): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    params: JSON.parse(r.params) as Record<string, string>,
    link: r.link,
    isRead: r.is_read === 1,
    createdAt: r.created_at,
  };
}

export function createNotification(input: {
  userId: number;
  type: NotificationType;
  params?: Record<string, string>;
  link?: string | null;
}): Notification {
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO notifications (user_id, type, params, link, is_read, created_at) VALUES (?,?,?,?,0,?)"
      )
      .run(input.userId, input.type, JSON.stringify(input.params ?? {}), input.link ?? null, now)
      .lastInsertRowid
  );
  return mapRow(
    sqlite.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as Row
  );
}

// Ayni bildirimi birden fazla aliciya gonderir (orn. workflow onaylayani +
// birden fazla mention); kendine bildirim gondermeyi onlemek icin
// excludeUserId cagiran tarafindan filtrelenmis bir userIds listesi
// gecirilmelidir (bkz. api/comments POST, api/workflow/[id]/transition POST).
export function createNotifications(
  userIds: number[],
  type: NotificationType,
  params?: Record<string, string>,
  link?: string | null
): void {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return;
  const now = new Date().toISOString();
  const paramsJson = JSON.stringify(params ?? {});
  const stmt = sqlite.prepare(
    "INSERT INTO notifications (user_id, type, params, link, is_read, created_at) VALUES (?,?,?,?,0,?)"
  );
  const tx = sqlite.transaction(() => {
    for (const userId of uniqueIds) {
      stmt.run(userId, type, paramsJson, link ?? null, now);
    }
  });
  tx();
}

export function listNotifications(
  userId: number,
  opts?: { unreadOnly?: boolean; limit?: number }
): Notification[] {
  const where = opts?.unreadOnly ? "AND is_read = 0" : "";
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = sqlite
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? ${where} ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit) as Row[];
  return rows.map(mapRow);
}

export function countUnreadNotifications(userId: number): number {
  const row = sqlite
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0")
    .get(userId) as { c: number };
  return row.c;
}

// true: bildirim bulundu ve bu kullaniciya ait (basariyla okundu/zaten okunmustu).
// false: bildirim yok veya baska bir kullaniciya ait (yetkisiz).
export function markNotificationRead(id: number, userId: number): boolean {
  const info = sqlite
    .prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return info.changes > 0;
}

export function markAllNotificationsRead(userId: number): number {
  const info = sqlite
    .prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0")
    .run(userId);
  return info.changes;
}

// Metindeki "@token" eşlerini (token: Unicode harf/rakam/._- , 2-40 karakter —
// Turkce "ı/ş/ğ/ü/ö/ç" dahil) users tablosunda ad (bosluksuz, kucuk harf)
// veya e-posta local-part'i ile tam eslesen kullanicilara cozer. Basit ama
// deterministik bir mention semantigi (fuzzy/kismi eslesme kasitli olarak
// yok — yanlis kisiye bildirim gitmesin).
export function resolveMentionedUserIds(text: string): number[] {
  const tokens = [...text.matchAll(/@([\p{L}\p{N}._-]{2,40})/gu)].map((m) => m[1].toLowerCase());
  if (tokens.length === 0) return [];
  const users = sqlite.prepare("SELECT id, name, email FROM users").all() as Array<{
    id: number;
    name: string;
    email: string;
  }>;
  const ids = new Set<number>();
  for (const token of new Set(tokens)) {
    for (const u of users) {
      const nameKey = u.name.toLowerCase().replace(/\s+/g, "");
      const emailLocal = u.email.toLowerCase().split("@")[0];
      if (nameKey === token || emailLocal === token) ids.add(u.id);
    }
  }
  return [...ids];
}
