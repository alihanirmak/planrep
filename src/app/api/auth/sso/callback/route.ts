import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSsoConfig } from "@/lib/sso/config";
import { discoverOidcConfig, exchangeCodeForTokens, verifyIdToken } from "@/lib/sso/oidc-client";
import { findOrProvisionSsoUser } from "@/lib/sso/sso-user";
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  SSO_STATE_COOKIE,
  ssoStateCookieOptions,
  verifySsoStateToken,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";

// SSO girisinin 2. adimi: IdP, kullaniciyi `code`+`state` query parametreleriyle
// buraya geri yonlendirir. state cookie'si dogrulanir (CSRF/replay), kod
// PKCE code_verifier ile token'a cevrilir, ID token imzasi/issuer/audience/
// nonce dogrulanir, kullanici bulunur/provision edilir ve normal
// SESSION_COOKIE verilir — akisin sonunda yerel login ile ayni sonuca ulasilir.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const loginUrl = new URL("/login", url.origin);

  if (errorParam) {
    loginUrl.searchParams.set("sso_error", "idp_denied");
    return NextResponse.redirect(loginUrl);
  }
  if (!code || !state) {
    loginUrl.searchParams.set("sso_error", "invalid_callback");
    return NextResponse.redirect(loginUrl);
  }

  const config = getSsoConfig();
  if (!config) {
    loginUrl.searchParams.set("sso_error", "sso_not_configured");
    return NextResponse.redirect(loginUrl);
  }

  const store = await cookies();
  const stateToken = store.get(SSO_STATE_COOKIE)?.value;
  const flow = stateToken ? await verifySsoStateToken(stateToken) : null;
  if (!flow || flow.state !== state) {
    loginUrl.searchParams.set("sso_error", "state_mismatch");
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set(SSO_STATE_COOKIE, "", { ...ssoStateCookieOptions(), maxAge: 0 });
    return res;
  }

  try {
    const discovery = await discoverOidcConfig(config.issuer);
    const tokens = await exchangeCodeForTokens(config, discovery, {
      code,
      codeVerifier: flow.codeVerifier,
    });
    const claims = await verifyIdToken(config, discovery, tokens.id_token, flow.nonce);
    const user = findOrProvisionSsoUser(config.providerLabel, claims, config);

    const sessionToken = await createSessionToken(user);
    logAudit(user.id, "login.sso", "user", user.id, { provider: config.providerLabel });

    const res = NextResponse.redirect(new URL("/", url.origin));
    res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    res.cookies.set(SSO_STATE_COOKIE, "", { ...ssoStateCookieOptions(), maxAge: 0 });
    return res;
  } catch {
    loginUrl.searchParams.set("sso_error", "login_failed");
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set(SSO_STATE_COOKIE, "", { ...ssoStateCookieOptions(), maxAge: 0 });
    return res;
  }
}
