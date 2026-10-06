// Minimal OIDC istemcisi: discovery, authorization URL olusturma, kod
// degisimi (token exchange) ve ID token dogrulama. Ag erisimi gerektiren
// fonksiyonlar (discover/exchange/verify) `fetch` kullanir; her biri bir
// `discovery` nesnesini parametre olarak alir ki testlerde gercek agdan
// bagimsiz, saf mantikla (veya mock fetch ile) dogrulanabilsinler.
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { SsoConfig } from "./config";

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type CacheEntry = { discovery: OidcDiscovery; fetchedAt: number };
const discoveryCache = new Map<string, CacheEntry>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export async function discoverOidcConfig(issuer: string): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.discovery;

  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`oidc_discovery_failed:${res.status}`);
  const discovery = (await res.json()) as OidcDiscovery;
  discoveryCache.set(issuer, { discovery, fetchedAt: Date.now() });
  return discovery;
}

export type AuthorizationUrlParams = {
  state: string;
  nonce: string;
  codeChallenge: string;
};

// Saf fonksiyon — ag erisimi yok, `discovery` disaridan verilir (test edilebilirlik icin).
export function buildAuthorizationUrl(
  config: SsoConfig,
  discovery: OidcDiscovery,
  params: AuthorizationUrlParams
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type TokenResponse = {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

export async function exchangeCodeForTokens(
  config: SsoConfig,
  discovery: OidcDiscovery,
  params: { code: string; codeVerifier: string }
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: params.codeVerifier,
  });
  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`oidc_token_exchange_failed:${res.status}`);
  const json = (await res.json()) as TokenResponse;
  if (!json.id_token) throw new Error("oidc_no_id_token");
  return json;
}

export type IdTokenClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  nonce?: string;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUri: string) {
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}

export async function verifyIdToken(
  config: SsoConfig,
  discovery: OidcDiscovery,
  idToken: string,
  expectedNonce: string
): Promise<IdTokenClaims> {
  const jwks = getJwks(discovery.jwks_uri);
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: discovery.issuer,
    audience: config.clientId,
  });
  if (payload.nonce !== expectedNonce) throw new Error("oidc_nonce_mismatch");
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("oidc_missing_sub");
  }
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    email_verified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
  };
}
