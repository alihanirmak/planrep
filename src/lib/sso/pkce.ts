// OAuth2 Authorization Code + PKCE (RFC 7636) icin yardimci fonksiyonlar.
// node:crypto uzerine, bagimliliksiz (ayni lib/totp.ts yaklasimi).
import { randomBytes, createHash } from "node:crypto";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

// 43-128 karakter arasi oneriliyor (RFC 7636 §4.1); 32 bayt -> 43 karakter base64url.
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

// S256: BASE64URL(SHA256(code_verifier))
export function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

export function generateNonce(): string {
  return base64url(randomBytes(16));
}
