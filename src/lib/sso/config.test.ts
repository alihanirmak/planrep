import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSsoConfig } from "./config";

const ENV_KEYS = [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "OIDC_SCOPES",
  "SSO_DEFAULT_ROLE",
  "SSO_PROVIDER_LABEL",
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getSsoConfig", () => {
  it("zorunlu degiskenler tanimli degilse null doner", () => {
    expect(getSsoConfig()).toBeNull();
  });

  it("sadece bir kismi tanimliyken de null doner", () => {
    process.env.OIDC_ISSUER = "https://issuer.example";
    process.env.OIDC_CLIENT_ID = "client1";
    expect(getSsoConfig()).toBeNull();
  });

  it("hepsi tanimliyken gecerli bir config doner, varsayilanlari uygular", () => {
    process.env.OIDC_ISSUER = "https://issuer.example/";
    process.env.OIDC_CLIENT_ID = "client1";
    process.env.OIDC_CLIENT_SECRET = "secret1";
    const cfg = getSsoConfig();
    expect(cfg).not.toBeNull();
    expect(cfg?.issuer).toBe("https://issuer.example");
    expect(cfg?.scopes).toBe("openid email profile");
    expect(cfg?.defaultRole).toBe("viewer");
    expect(cfg?.providerLabel).toBe("SSO");
  });

  it("sondaki slash'lar issuer'dan temizlenir", () => {
    process.env.OIDC_ISSUER = "https://issuer.example///";
    process.env.OIDC_CLIENT_ID = "c";
    process.env.OIDC_CLIENT_SECRET = "s";
    expect(getSsoConfig()?.issuer).toBe("https://issuer.example");
  });

  it("gecersiz SSO_DEFAULT_ROLE degeri viewer'a duser", () => {
    process.env.OIDC_ISSUER = "https://issuer.example";
    process.env.OIDC_CLIENT_ID = "c";
    process.env.OIDC_CLIENT_SECRET = "s";
    process.env.SSO_DEFAULT_ROLE = "superadmin";
    expect(getSsoConfig()?.defaultRole).toBe("viewer");
  });

  it("gecerli SSO_DEFAULT_ROLE (admin/planner) kabul edilir", () => {
    process.env.OIDC_ISSUER = "https://issuer.example";
    process.env.OIDC_CLIENT_ID = "c";
    process.env.OIDC_CLIENT_SECRET = "s";
    process.env.SSO_DEFAULT_ROLE = "planner";
    expect(getSsoConfig()?.defaultRole).toBe("planner");
  });

  it("ozel providerLabel/redirectUri/scopes degerlerini okur", () => {
    process.env.OIDC_ISSUER = "https://issuer.example";
    process.env.OIDC_CLIENT_ID = "c";
    process.env.OIDC_CLIENT_SECRET = "s";
    process.env.OIDC_REDIRECT_URI = "https://app.example/callback";
    process.env.OIDC_SCOPES = "openid email";
    process.env.SSO_PROVIDER_LABEL = "Okta";
    const cfg = getSsoConfig();
    expect(cfg?.redirectUri).toBe("https://app.example/callback");
    expect(cfg?.scopes).toBe("openid email");
    expect(cfg?.providerLabel).toBe("Okta");
  });

  it("bos string degerleri tanimsiz gibi davranir", () => {
    process.env.OIDC_ISSUER = "   ";
    process.env.OIDC_CLIENT_ID = "c";
    process.env.OIDC_CLIENT_SECRET = "s";
    expect(getSsoConfig()).toBeNull();
  });
});
