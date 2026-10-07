import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Not: "/api/auth/sso" (login/callback/status) ve "/signup"+"/api/auth/signup"
// de public olmali — oturumsuz bir kullanici SSO ile giris yapmaya veya yeni
// bir tenant olusturmaya calisiyor olabilir. Oncesinde "/api/auth/sso/*"
// burada eksikti (SSO girisi fiilen hic calismiyordu — middleware once
// 401 donuyordu); bu oturumda duzeltildi. "/api/v1" (REST export API,
// Power BI/Tableau icin) de public listede — SESSION_COOKIE DEGIL kendi
// Authorization: Bearer <api-key> basligini kullanir (bkz. lib/api-auth.ts),
// kimlik dogrulama middleware'de degil route'un kendisinde yapilir.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/sso",
  "/api/v1",
];

// Kaba taneli, bellek-ici rate limit kurallari: brute-force (login) ve
// agir/pahali uclar (AI sorgu, export) icin basit bir koruma katmani.
const RATE_LIMIT_RULES: Array<{
  test: (pathname: string, method: string) => boolean;
  limit: number;
  windowMs: number;
  name: string;
}> = [
  {
    name: "login",
    test: (p, m) => m === "POST" && p === "/api/auth/login",
    limit: 10,
    windowMs: 5 * 60 * 1000,
  },
  {
    name: "ai",
    test: (p, m) => m === "POST" && p === "/api/ai/query",
    limit: 20,
    windowMs: 10 * 60 * 1000,
  },
  {
    // AI ile gelistirme PLAN uclari (henuz DB'ye yazmaz) — ai/query'den biraz
    // daha siki, cunku axet CLI cagrisi daha agir bir prompt kullanir.
    name: "ai-dev-plan",
    test: (p, m) => m === "POST" && (p === "/api/ai/dev/plan" || p === "/api/ai/dev/plan-from-excel"),
    limit: 15,
    windowMs: 10 * 60 * 1000,
  },
  {
    // AI ile gelistirme APPLY ucu — GERCEKTEN DB'ye yazar, en siki limit.
    name: "ai-dev-apply",
    test: (p, m) => m === "POST" && p === "/api/ai/dev/apply",
    limit: 10,
    windowMs: 10 * 60 * 1000,
  },
  {
    name: "export",
    test: (p, m) => m === "POST" && p.startsWith("/api/export/"),
    limit: 30,
    windowMs: 5 * 60 * 1000,
  },
  {
    name: "signup",
    test: (p, m) => m === "POST" && p === "/api/auth/signup",
    limit: 5,
    windowMs: 15 * 60 * 1000,
  },
  {
    name: "odata",
    test: (p) => p.startsWith("/api/v1/odata"),
    limit: 120,
    windowMs: 5 * 60 * 1000,
  },
];

// Yukaridaki ozel kurallara girmeyen tum diger /api/* uclari icin IP bazli
// kaba taneli bir taban limit (madde 12 — "API rate limiting tutarliligi"
// acigi: eskiden rate limit sadece 5 ozel endpoint'te uygulaniyordu, kalan
// ~56 route hic korumasizdi). Ozel kurallar zaten kendi daha siki limitlerini
// uyguladigindan burada tekrar calismaz (asagida `else if` ile ayristirilir).
const DEFAULT_API_RATE_LIMIT = { limit: 300, windowMs: 5 * 60 * 1000 };

function tooManyRequests(resetAt: number) {
  return NextResponse.json(
    { error: "rate_limited" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) },
    }
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  const rule = RATE_LIMIT_RULES.find((r) => r.test(pathname, method));
  if (rule) {
    const result = rateLimit(`${rule.name}:${clientIp(req)}`, rule.limit, rule.windowMs);
    if (!result.allowed) return tooManyRequests(result.resetAt);
  } else if (pathname.startsWith("/api/")) {
    const result = rateLimit(
      `api:${clientIp(req)}`,
      DEFAULT_API_RATE_LIMIT.limit,
      DEFAULT_API_RATE_LIMIT.windowMs
    );
    if (!result.allowed) return tooManyRequests(result.resetAt);
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Admin bölgeleri
  if (
    (pathname.startsWith("/admin") || pathname.startsWith("/api/users")) &&
    session.role !== "admin"
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // AI ile gelistirme bolgesi — JWT'deki aiDevAccess ile ilk (hizli) kontrol.
  // Route'larin kendisi (bkz. lib/ai/dev-permission.ts) AYRICA DB'den canli
  // kontrol eder (admin erisimi geri aldiginda 12 saatlik JWT suresi
  // dolmadan da etkili olsun diye) — burasi SADECE sayfanin/API'nin
  // acikca erisimsiz birine goruntulenmesini onleyen ilk savunma hatti.
  if ((pathname.startsWith("/ai-dev") || pathname.startsWith("/api/ai/dev")) && !session.aiDevAccess) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)"],
};
