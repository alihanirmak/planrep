import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { SsoConfig } from "./config";
import type { IdTokenClaims } from "./oidc-client";

const testDbPath = path.resolve(
  __dirname,
  `../../../data/.vitest-sso-user-${process.pid}-${Date.now()}.db`
);

let ssoUser: typeof import("./sso-user");
let dbMod: typeof import("../db");

const config: SsoConfig = {
  issuer: "https://issuer.example",
  clientId: "client1",
  clientSecret: "secret1",
  redirectUri: "https://app.example/callback",
  scopes: "openid email profile",
  defaultRole: "viewer",
  providerLabel: "Okta",
};

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  ssoUser = await import("./sso-user");
  dbMod = await import("../db");
});

afterAll(() => {
  dbMod.sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("findOrProvisionSsoUser", () => {
  it("hic kullanici yoksa yeni bir kullanici provision eder (SSO_DEFAULT_ROLE ile)", () => {
    const claims: IdTokenClaims = { sub: "sub-1", email: "new.user@example.com", name: "New User" };
    const result = ssoUser.findOrProvisionSsoUser("Okta", claims, config);
    expect(result.email).toBe("new.user@example.com");
    expect(result.name).toBe("New User");
    expect(result.role).toBe("viewer");

    const row = dbMod.db.select().from(dbMod.users).where(eq(dbMod.users.id, result.id)).get();
    expect(row?.ssoProvider).toBe("Okta");
    expect(row?.ssoSubject).toBe("sub-1");
    expect(row?.authProvider).toBe("sso");
  });

  it("ayni sub ile ikinci giriste AYNI kullaniciyi doner (yeni kayit acilmaz)", () => {
    const claims: IdTokenClaims = { sub: "sub-2", email: "repeat@example.com", name: "Repeat User" };
    const first = ssoUser.findOrProvisionSsoUser("Okta", claims, config);
    const second = ssoUser.findOrProvisionSsoUser("Okta", { ...claims, name: "Updated Name" }, config);
    expect(second.id).toBe(first.id);
  });

  it("ayni email'e sahip VAR OLAN yerel kullaniciya SSO kimligi baglanir", () => {
    const now = new Date().toISOString();
    const inserted = dbMod.db
      .insert(dbMod.users)
      .values({
        email: "existing.local@example.com",
        name: "Existing Local",
        passwordHash: "irrelevant-hash",
        role: "planner",
        locale: "tr",
        createdAt: now,
      })
      .returning()
      .get();

    const claims: IdTokenClaims = {
      sub: "sub-3",
      email: "existing.local@example.com",
      name: "Existing Local (SSO)",
    };
    const result = ssoUser.findOrProvisionSsoUser("Okta", claims, config);
    expect(result.id).toBe(inserted.id);
    expect(result.role).toBe("planner");

    const row = dbMod.db.select().from(dbMod.users).where(eq(dbMod.users.id, inserted.id)).get();
    expect(row?.ssoProvider).toBe("Okta");
    expect(row?.ssoSubject).toBe("sub-3");
    expect(row?.authProvider).toBe("sso");
  });

  it("email claim'i yoksa hata firlatir", () => {
    const claims: IdTokenClaims = { sub: "sub-no-email" };
    expect(() => ssoUser.findOrProvisionSsoUser("Okta", claims, config)).toThrow(/sso_no_email/);
  });

  it("farkli provider ile ayni sub tekrar kullanilirsa email'e gore eslesir (sub carpismasi yerine)", () => {
    const claimsA: IdTokenClaims = { sub: "shared-sub", email: "providerA@example.com" };
    const resultA = ssoUser.findOrProvisionSsoUser("Okta", claimsA, config);

    const claimsB: IdTokenClaims = { sub: "shared-sub", email: "providerB@example.com" };
    const resultB = ssoUser.findOrProvisionSsoUser("AzureAD", claimsB, config);

    expect(resultB.id).not.toBe(resultA.id);
  });
});
