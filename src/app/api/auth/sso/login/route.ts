import { NextResponse } from "next/server";
import { getSsoConfig } from "@/lib/sso/config";
import { discoverOidcConfig, buildAuthorizationUrl } from "@/lib/sso/oidc-client";
import { generateCodeChallenge, generateCodeVerifier, generateNonce, generateState } from "@/lib/sso/pkce";
import { createSsoStateToken, ssoStateCookieOptions, SSO_STATE_COOKIE } from "@/lib/auth";

// SSO girisinin 1. adimi: IdP'nin authorization endpoint'ine PKCE'li
// yonlendirme. state/nonce/codeVerifier imzali, kisa omurlu bir cookie'de
// saklanir (sunucu tarafli session store olmadigindan — bkz. lib/session.ts
// ustundeki SSO_STATE_COOKIE notu); callback bu cookie'yi okuyup dogrular.
export async function GET() {
  const config = getSsoConfig();
  if (!config) {
    return NextResponse.json({ error: "sso_not_configured" }, { status: 503 });
  }

  let discovery;
  try {
    discovery = await discoverOidcConfig(config.issuer);
  } catch {
    return NextResponse.json({ error: "sso_discovery_failed" }, { status: 502 });
  }

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl = buildAuthorizationUrl(config, discovery, { state, nonce, codeChallenge });
  const stateToken = await createSsoStateToken({ state, nonce, codeVerifier });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(SSO_STATE_COOKIE, stateToken, ssoStateCookieOptions());
  return res;
}
