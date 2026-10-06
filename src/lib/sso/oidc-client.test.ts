import { describe, it, expect, afterEach, vi } from "vitest";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import {
  discoverOidcConfig,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  verifyIdToken,
  type OidcDiscovery,
} from "./oidc-client";
import type { SsoConfig } from "./config";

const config: SsoConfig = {
  issuer: "https://issuer.example",
  clientId: "client1",
  clientSecret: "secret1",
  redirectUri: "https://app.example/api/auth/sso/callback",
  scopes: "openid email profile",
  defaultRole: "viewer",
  defaultTenantId: 1,
  providerLabel: "Okta",
};

const discovery: OidcDiscovery = {
  issuer: "https://issuer.example",
  authorization_endpoint: "https://issuer.example/authorize",
  token_endpoint: "https://issuer.example/token",
  jwks_uri: "https://issuer.example/jwks",
};

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("discoverOidcConfig", () => {
  it("well-known endpoint'ini cagirip discovery dokumanini doner", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(discovery), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await discoverOidcConfig("https://issuer.example");
    expect(result).toEqual(discovery);
    expect(fetchMock).toHaveBeenCalledWith("https://issuer.example/.well-known/openid-configuration");
  });

  it("HTTP hatasinda anlamli bir hata firlatir", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(discoverOidcConfig("https://down.example")).rejects.toThrow(/oidc_discovery_failed/);
  });

  it("ayni issuer icin sonucu cache'ler (ikinci cagri fetch yapmaz)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(discovery), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    await discoverOidcConfig("https://cached.example");
    await discoverOidcConfig("https://cached.example");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("buildAuthorizationUrl", () => {
  it("gerekli tum OAuth2/PKCE parametrelerini icerir", () => {
    const url = buildAuthorizationUrl(config, discovery, {
      state: "state123",
      nonce: "nonce123",
      codeChallenge: "challenge123",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://issuer.example/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client1");
    expect(parsed.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(parsed.searchParams.get("state")).toBe("state123");
    expect(parsed.searchParams.get("nonce")).toBe("nonce123");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge123");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("exchangeCodeForTokens", () => {
  it("token endpoint'ine dogru form-urlencoded govdeyle POST eder", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = new URLSearchParams(init.body as string);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code-1");
      expect(body.get("code_verifier")).toBe("verifier-1");
      expect(body.get("client_secret")).toBe("secret1");
      return new Response(JSON.stringify({ id_token: "fake.id.token" }), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await exchangeCodeForTokens(config, discovery, {
      code: "auth-code-1",
      codeVerifier: "verifier-1",
    });
    expect(result.id_token).toBe("fake.id.token");
  });

  it("HTTP hatasinda hata firlatir", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 400 })) as unknown as typeof fetch;
    await expect(
      exchangeCodeForTokens(config, discovery, { code: "x", codeVerifier: "y" })
    ).rejects.toThrow(/oidc_token_exchange_failed/);
  });

  it("id_token eksikse hata firlatir", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    await expect(
      exchangeCodeForTokens(config, discovery, { code: "x", codeVerifier: "y" })
    ).rejects.toThrow(/oidc_no_id_token/);
  });
});

describe("verifyIdToken", () => {
  async function signIdToken(claims: Record<string, unknown>, kid = "kid-1") {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuedAt()
      .setIssuer(discovery.issuer)
      .setAudience(config.clientId)
      .setSubject((claims.sub as string) ?? "user-1")
      .setExpirationTime("5m")
      .sign(privateKey);
    return { token, jwk: { ...jwk, kid, use: "sig", alg: "RS256" } };
  }

  function mockJwks(jwk: unknown) {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
    ) as unknown as typeof fetch;
  }

  it("gecerli imza/issuer/audience/nonce ile claims'i dondurur", async () => {
    const { token, jwk } = await signIdToken({
      email: "user@example.com",
      name: "Test User",
      nonce: "nonce-abc",
    });
    mockJwks(jwk);
    const claims = await verifyIdToken(config, { ...discovery, jwks_uri: "https://unique1.example/jwks" }, token, "nonce-abc");
    expect(claims.email).toBe("user@example.com");
    expect(claims.name).toBe("Test User");
    expect(claims.sub).toBe("user-1");
  });

  it("nonce uyusmazsa hata firlatir", async () => {
    const { token, jwk } = await signIdToken({ nonce: "nonce-abc" });
    mockJwks(jwk);
    await expect(
      verifyIdToken(config, { ...discovery, jwks_uri: "https://unique2.example/jwks" }, token, "wrong-nonce")
    ).rejects.toThrow(/oidc_nonce_mismatch/);
  });

  it("yanlis audience ile dogrulama basarisiz olur", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const token = await new SignJWT({ nonce: "n1" })
      .setProtectedHeader({ alg: "RS256", kid: "kid-x" })
      .setIssuedAt()
      .setIssuer(discovery.issuer)
      .setAudience("wrong-client")
      .setSubject("user-1")
      .setExpirationTime("5m")
      .sign(privateKey);
    mockJwks({ ...jwk, kid: "kid-x", use: "sig", alg: "RS256" });
    await expect(
      verifyIdToken(config, { ...discovery, jwks_uri: "https://unique3.example/jwks" }, token, "n1")
    ).rejects.toThrow();
  });
});
