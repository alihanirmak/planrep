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
