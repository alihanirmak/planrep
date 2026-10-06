// Harici BI araclarinin (Power BI/Tableau vb.) REST export API'sine
// (app/api/v1/*) erisebilmesi icin kullanici bazli API anahtarlari.
//
// Guvenlik notu: ham anahtar SADECE olusturma aninda bir kez donulur,
// DB'de hic saklanmaz — sadece sha256 hash'i saklanir. Bir anahtar
// kaybedilirse/sizdirilirse yeniden GORUNTULENEMEZ, sadece iptal edilip
// yeni bir anahtar olusturulabilir (sifre sifirlama ile ayni mantik).
import { createHash, randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, apiKeys, users } from "./db";

const KEY_PREFIX = "pr_live_";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export type ApiKeySummary = {
  id: number;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKeySummary & { rawKey: string };

// Yeni bir anahtar olusturur ve ham degeri (bir kerelik) doner.
export function createApiKey(tenantId: number, userId: number, name: string): CreatedApiKey {
  const rawKey = KEY_PREFIX + randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  const inserted = db
    .insert(apiKeys)
    .values({
      tenantId,
      userId,
      name,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, KEY_PREFIX.length + 8),
      createdAt: now,
    })
    .returning()
    .get();
  return {
    id: inserted.id,
    name: inserted.name,
    keyPrefix: inserted.keyPrefix,
    createdAt: inserted.createdAt,
    lastUsedAt: null,
    revokedAt: null,
    rawKey,
  };
}

// Bir kullanicinin TUM anahtarlarini (iptal edilmis olanlar dahil, UI'da
// "iptal edildi" olarak gosterilir) listeler — ham anahtar hic dondurulmez.
export function listApiKeys(tenantId: number, userId: number): ApiKeySummary[] {
  const rows = db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.userId, userId)))
    .all();
  return rows
    .sort((a, b) => b.id - a.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      revokedAt: r.revokedAt,
    }));
}

export function revokeApiKey(tenantId: number, userId: number, id: number): boolean {
  const now = new Date().toISOString();
  const result = db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(
      and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt))
    )
    .run();
  return result.changes > 0;
}

export type VerifiedApiKey = {
  apiKeyId: number;
  tenantId: number;
  userId: number;
  role: "admin" | "planner" | "viewer";
  locale: string;
};

// Ham bir anahtari dogrular: hash'ini DB'de arar, iptal edilmemis olmali,
// kullaniciya ait tenant/role bilgisini de birlikte doner (export API'nin
// erisim kontrolu — allowedSets vb. — mevcut oturum tabanli mantikla
// AYNI sekilde calisabilsin diye). Basarili her dogrulamada lastUsedAt
// guncellenir (son kullanim zamani, denetim/temizlik amacli).
export function verifyApiKey(rawKey: string): VerifiedApiKey | null {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = hashKey(rawKey);
  const row = db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).get();
  if (!row || row.revokedAt) return null;

  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user || user.tenantId !== row.tenantId) return null;

  db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, row.id)).run();

  return { apiKeyId: row.id, tenantId: row.tenantId, userId: user.id, role: user.role, locale: user.locale };
}
