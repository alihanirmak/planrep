import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "planrep_session";

function resolveSecret(): string {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret && envSecret.length >= 16) return envSecret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET env degiskeni tanimli degil (en az 16 karakter). " +
        "Production ortaminda zorunludur."
    );
  }

  // Development/test: process basina rastgele uretilen gecici secret.
  // Sunucu yeniden baslatildiginda mevcut oturumlar gecersiz olur.
  console.warn(
    "[session] JWT_SECRET tanimli degil veya cok kisa; gelistirme icin " +
      "rastgele, kalici olmayan bir secret uretildi. Production icin .env " +
      "dosyasinda JWT_SECRET=<en az 16 karakter> tanimlayin."
  );
  return randomBytes(32).toString("hex");
}

const secret = new TextEncoder().encode(resolveSecret());

export const SESSION_MAX_AGE_SECONDS = 12 * 3600;

export function sessionCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAge ?? SESSION_MAX_AGE_SECONDS,
  };
}

export type Role = "admin" | "planner" | "viewer";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
  locale: string;
};

export async function createSessionToken(user: SessionUser): Promise<string> {
  return await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

// --- 2FA ara-oturum (pre-auth) tokeni ---
//
// Sifre dogru ama 2FA kodu henuz girilmemisken, tam SESSION_COOKIE
// verilmeden once kullaniciyi "parola dogrulandi, TOTP kodu bekleniyor"
// durumunda tutmak icin kisa omurlu, AYRI bir cookie/token. Normal oturum
// tokeninden kasitli olarak farkli bir "purpose" claim'i tasir ki biri
// yanlislikla pre-auth tokenini session olarak kullanamasin (verifySessionToken
// bu payload'u SessionUser olarak kabul etmez — role/email alanlari yok).
export const PREAUTH_COOKIE = "planrep_preauth";
const PREAUTH_MAX_AGE_SECONDS = 5 * 60; // 5 dakika

export async function createPreAuthToken(userId: number): Promise<string> {
  return await new SignJWT({ purpose: "2fa-pending", userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PREAUTH_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

export async function verifyPreAuthToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== "2fa-pending" || typeof payload.userId !== "number") return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function preAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PREAUTH_MAX_AGE_SECONDS,
  };
}
