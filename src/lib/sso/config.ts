// SSO (OpenID Connect) yapilandirmasi — ortam degiskenlerinden okunur.
//
// Tasarim karari: SAML yerine OIDC (OAuth2 Authorization Code + PKCE)
// implemente edildi. Gerekce: Okta ve Azure AD (ROADMAP'teki hedef
// IdP'ler) ikisi de OIDC'yi tam destekliyor; OIDC modern standart ve
// `jose` zaten bagimlilik olarak mevcut (XML imzalama/sifreleme
// gerektiren SAML icin yeni, agir bir bagimlilik — ornegin "saml2-js"/
// "node-saml" — eklemek bu projenin "bagimlilik yuzeyini buyutme"
// prensibiyle celisir, bkz. lib/totp.ts ustundeki benzer karar).
// SAML kapsam disi birakildi; ileride gerekirse ayri bir is olarak ele
// alinabilir.
export type SsoConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  defaultRole: "admin" | "planner" | "viewer";
  providerLabel: string;
};

function envTrim(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// SSO_ISSUER/CLIENT_ID/CLIENT_SECRET'in UCU de tanimli degilse SSO
// devre disi kabul edilir (login sayfasinda buton gosterilmez, ilgili
// route'lar 503 doner) — varsayilan acik/yapilandirilmamis birakilmaz
// (ayni `CRON_SECRET` deseni, bkz. lib/scheduled-sync.ts).
export function getSsoConfig(): SsoConfig | null {
  const issuer = envTrim("OIDC_ISSUER");
  const clientId = envTrim("OIDC_CLIENT_ID");
  const clientSecret = envTrim("OIDC_CLIENT_SECRET");
  if (!issuer || !clientId || !clientSecret) return null;

  const defaultRoleRaw = envTrim("SSO_DEFAULT_ROLE") ?? "viewer";
  const defaultRole: SsoConfig["defaultRole"] =
    defaultRoleRaw === "admin" || defaultRoleRaw === "planner" ? defaultRoleRaw : "viewer";

  return {
    issuer: issuer.replace(/\/+$/, ""),
    clientId,
    clientSecret,
    redirectUri: envTrim("OIDC_REDIRECT_URI") ?? "http://localhost:3000/api/auth/sso/callback",
    scopes: envTrim("OIDC_SCOPES") ?? "openid email profile",
    defaultRole,
    providerLabel: envTrim("SSO_PROVIDER_LABEL") ?? "SSO",
  };
}
