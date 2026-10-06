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
  tenantId: number;
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

// --- SSO (OIDC) akis-durumu tokeni ---
//
// Authorization Code + PKCE akisinda IdP'ye yonlendirmeden once uretilen
// state/nonce/codeVerifier degerlerini, callback'e geri donulene kadar
// SUNUCU TARAFINDA bir session store tutmadan (bu uygulamada sunucu
// taraflı session store yok) saklamak icin imzali, kisa omurlu bir
// cookie/token. state=CSRF/replay korumasi, nonce=ID token tazeligi,
// codeVerifier=PKCE code_challenge'in karsiligi.
export const SSO_STATE_COOKIE = "planrep_sso_state";
const SSO_STATE_MAX_AGE_SECONDS = 5 * 60; // 5 dakika — IdP'de login suresi icin yeterli

export type SsoFlowState = { state: string; nonce: string; codeVerifier: string };

export async function createSsoStateToken(flow: SsoFlowState): Promise<string> {
  return await new SignJWT({ purpose: "sso-flow", ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SSO_STATE_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

export async function verifySsoStateToken(token: string): Promise<SsoFlowState | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (
      payload.purpose !== "sso-flow" ||
      typeof payload.state !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.codeVerifier !== "string"
    ) {
      return null;
    }
    return { state: payload.state, nonce: payload.nonce, codeVerifier: payload.codeVerifier };
  } catch {
    return null;
  }
}

export function ssoStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SSO_STATE_MAX_AGE_SECONDS,
  };
}
