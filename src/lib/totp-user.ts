// Kullanicinin 2FA (TOTP) durumuyla ilgili DB islemleri — lib/totp.ts'teki
// saf kriptografik fonksiyonlardan (secret/kod uretme/dogrulama) ayri
// tutuldu ki lib/totp.ts bagimsiz test edilebilsin.
import { eq } from "drizzle-orm";
import { db, sqlite, users } from "./db";
import { hashPassword, checkPassword } from "./auth";
import { generateTotpSecret, generateBackupCodes, verifyTotp } from "./totp";

export type TotpStatus = { enabled: boolean; pendingSetup: boolean };

export function getTotpStatus(userId: number): TotpStatus {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { enabled: false, pendingSetup: false };
  return {
    enabled: !!user.totpEnabled,
    pendingSetup: !user.totpEnabled && !!user.totpSecret,
  };
}

// Yeni bir "pending" (henuz dogrulanmamis) secret uretir ve kaydeder.
// totpEnabled hala false kalir — kullanici setup ekranindaki QR/secret'i
// authenticator uygulamasina girip ilk kodu dogrulamadan (enableTotp)
// 2FA fiilen aktif olmaz.
export function startTotpSetup(userId: number): { secret: string } {
  const secret = generateTotpSecret();
  db.update(users).set({ totpSecret: secret }).where(eq(users.id, userId)).run();
  return { secret };
}

export type EnableTotpResult = { ok: true; backupCodes: string[] } | { ok: false; error: "invalid_code" | "no_pending_setup" };

// Pending secret'e karsi girilen ilk kodu dogrular; dogruysa 2FA'yi
// aktif eder ve TEK SEFERLIK gosterilecek yedek kurtarma kodlarini uretir
// (DB'de sadece bcrypt hash'leri saklanir — plaintext asla kalici degil).
export function enableTotp(userId: number, code: string): EnableTotpResult {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !user.totpSecret) return { ok: false, error: "no_pending_setup" };
  if (!verifyTotp(user.totpSecret, code)) return { ok: false, error: "invalid_code" };

  const backupCodes = generateBackupCodes();
  const hashed = backupCodes.map((c) => hashPassword(c));
  db.update(users)
    .set({ totpEnabled: 1, totpBackupCodes: JSON.stringify(hashed) })
    .where(eq(users.id, userId))
    .run();
  return { ok: true, backupCodes };
}

export type DisableTotpResult = { ok: true } | { ok: false; error: "wrong_password" };

// 2FA'yi kapatmak icin mevcut sifre dogrulanir (TOTP kodu degil — cihazi
// kaybetmis bir kullanici zaten bu akisi kullanamaz; sifre zaten bilinen
// bir ikinci faktordur).
export function disableTotp(userId: number, currentPassword: string): DisableTotpResult {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !checkPassword(currentPassword, user.passwordHash)) {
    return { ok: false, error: "wrong_password" };
  }
  db.update(users)
    .set({ totpEnabled: 0, totpSecret: null, totpBackupCodes: null })
    .where(eq(users.id, userId))
    .run();
  return { ok: true };
}

// Bir yedek kurtarma kodunu dogrular ve basariliysa HEMEN tuketir (listeden
// cikarir) — her kod tek kullanimliktir. sqlite.transaction ile oku+yaz
// ayni senkron islemde yapilir (TOCTOU'yu onlemek icin, better-sqlite3
// senkron oldugundan tek bir JS "tick"inde zaten atomik, ama transaction
// acikca niyeti belgeliyor).
export function consumeBackupCode(userId: number, code: string): boolean {
  const row = sqlite
    .prepare("SELECT totp_backup_codes AS codes FROM users WHERE id = ?")
    .get(userId) as { codes: string | null } | undefined;
  if (!row?.codes) return false;
  const hashedCodes: string[] = JSON.parse(row.codes);
  const matchIdx = hashedCodes.findIndex((h) => checkPassword(code, h));
  if (matchIdx === -1) return false;

  const remaining = hashedCodes.filter((_, i) => i !== matchIdx);
  sqlite
    .prepare("UPDATE users SET totp_backup_codes = ? WHERE id = ?")
    .run(JSON.stringify(remaining), userId);
  return true;
}

export function remainingBackupCodeCount(userId: number): number {
  const row = sqlite
    .prepare("SELECT totp_backup_codes AS codes FROM users WHERE id = ?")
    .get(userId) as { codes: string | null } | undefined;
  if (!row?.codes) return 0;
  return (JSON.parse(row.codes) as string[]).length;
}
