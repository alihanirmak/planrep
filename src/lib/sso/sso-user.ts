// SSO kullanicisi provisioning/eslesme mantigi — DB katmani.
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, users } from "../db";
import { hashPassword } from "../auth";
import type { SsoConfig } from "./config";
import type { IdTokenClaims } from "./oidc-client";

export type SsoLoginResult = {
  id: number;
  tenantId: number;
  email: string;
  name: string;
  role: "admin" | "planner" | "viewer";
  locale: string;
};

// Akis: 1) ssoProvider+ssoSubject ile ESLESEN bir kullanici var mi? varsa
// o dondurulur (sonraki girislerde, isim degismis olsa bile ayni hesap).
// 2) yoksa, aynI email'e sahip (yerel sifreyle acilmis) bir kullanici var
// mi? varsa SSO kimligi O KULLANICIYA baglanir (hesap birlestirme) —
// boylece once sifreyle kayitli bir kullanici, sonradan SSO'ya gecebilir.
// 3) hic kullanici yoksa, SSO_DEFAULT_ROLE ile yeni bir kullanici
// otomatik olusturulur ("provisioning") — passwordHash rastgele, bilinmeyen
// bir deger alir (sifreyle giris fiilen imkansiz; admin isterse sonradan
// /api/users/[id] PATCH ile sifre atayabilir).
export function findOrProvisionSsoUser(
  provider: string,
  claims: IdTokenClaims,
  config: SsoConfig
): SsoLoginResult {
  const bySubject = db
    .select()
    .from(users)
    .where(eq(users.ssoSubject, claims.sub))
    .get();
  if (bySubject && bySubject.ssoProvider === provider) {
    return toResult(bySubject);
  }

  const email = claims.email?.trim().toLowerCase();
  if (!email) throw new Error("sso_no_email");

  const byEmail = db.select().from(users).where(eq(users.email, email)).get();
  if (byEmail) {
    db.update(users)
      .set({ ssoProvider: provider, ssoSubject: claims.sub, authProvider: "sso" })
      .where(eq(users.id, byEmail.id))
      .run();
    return toResult({ ...byEmail, role: byEmail.role });
  }

  const now = new Date().toISOString();
  const randomPassword = randomBytes(24).toString("hex");
  const inserted = db
    .insert(users)
    .values({
      tenantId: config.defaultTenantId,
      email,
      name: claims.name?.trim() || email,
      passwordHash: hashPassword(randomPassword),
      role: config.defaultRole,
      locale: "tr",
      createdAt: now,
      ssoProvider: provider,
      ssoSubject: claims.sub,
      authProvider: "sso",
    })
    .returning()
    .get();
  return toResult(inserted);
}

function toResult(user: {
  id: number;
  tenantId: number;
  email: string;
  name: string;
  role: "admin" | "planner" | "viewer";
  locale: string;
}): SsoLoginResult {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
  };
}
