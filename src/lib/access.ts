import { sqlite } from "./db";
import { withDescendants, type DimInfo } from "./model";
import type { SessionUser } from "./session";

export type AccessEntry = { dimensionId: number; memberCodes: string[] };

export type CommentEntityType = "report" | "dashboard" | "cell";

// Yorum/okuma amacli entity-level yetkilendirme: rapor/dashboard sahibi,
// paylasilan (shared=1) kayitlar veya ADMIN erisebilir. "cell" turu henuz
// bir sahiplik modeline baglanmadigi icin sadece admin'e aciliyor.
// ONEMLI: tenant kontrolu admin kisayolundan ONCE yapilir — aksi halde bir
// tenant'in admin'i, baska bir tenant'a ait rapor/dashboard'un id'sini
// tahmin ederek erisebilirdi (bu kontrol sirasi bilerek boyle; admin rolu
// SADECE kendi tenant'i icinde "her seye erisebilir" anlamina gelir).
export function canAccessCommentEntity(
  session: SessionUser,
  entityType: CommentEntityType,
  entityId: string
): boolean {
  if (entityType === "report" || entityType === "dashboard") {
    const table = entityType === "report" ? "reports" : "dashboards";
    const row = sqlite
      .prepare(`SELECT owner_id, shared, tenant_id FROM ${table} WHERE id = ?`)
      .get(Number(entityId)) as { owner_id: number; shared: number; tenant_id: number } | undefined;
    if (!row || row.tenant_id !== session.tenantId) return false;
    if (session.role === "admin") return true;
    return row.owner_id === session.id || row.shared === 1;
  }

  // "cell" turu: sahiplik modeli yok, admin'e aciliyor (tenant zaten
  // session.role uzerinden dolayli olarak dogru tenant'a ait kabul edilir
  // cunku admin rolu kendi tenant'inin disinda bir yetki tasimiyor).
  return session.role === "admin";
}

export function getUserAccess(userId: number): AccessEntry[] {
  const rows = sqlite
    .prepare(
      "SELECT dimension_id AS dimensionId, member_codes AS memberCodes FROM user_dim_access WHERE user_id = ?"
    )
    .all(userId) as Array<{ dimensionId: number; memberCodes: string }>;
  return rows.map((r) => ({
    dimensionId: r.dimensionId,
    memberCodes: JSON.parse(r.memberCodes) as string[],
  }));
}

export function setUserAccess(userId: number, entries: AccessEntry[]) {
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM user_dim_access WHERE user_id = ?").run(userId);
    const ins = sqlite.prepare(
      "INSERT INTO user_dim_access (user_id, dimension_id, member_codes) VALUES (?,?,?)"
    );
    for (const e of entries) {
      if (e.memberCodes.length > 0) {
        ins.run(userId, e.dimensionId, JSON.stringify(e.memberCodes));
      }
    }
  });
  tx();
}

// Modelin boyutlari icin izinli yaprak kodu kumeleri (kayit yoksa kisitsiz = undefined)
export function allowedSets(
  userId: number,
  dims: DimInfo[]
): Map<string, Set<string>> {
  const access = getUserAccess(userId);
  const out = new Map<string, Set<string>>();
  for (const entry of access) {
    const dim = dims.find((d) => d.id === entry.dimensionId);
    if (!dim) continue;
    out.set(dim.code, new Set(withDescendants(dim.members, entry.memberCodes)));
  }
  return out;
}

// Filtre kumesini erisim kumesiyle kesistir; erisim tanimliysa daima uygulanir
export function restrictCodes(
  requested: string[] | undefined,
  allowed: Set<string> | undefined
): string[] | undefined {
  if (!allowed) return requested;
  if (!requested || requested.length === 0) return [...allowed];
  return requested.filter((c) => allowed.has(c));
}
