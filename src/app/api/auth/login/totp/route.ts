import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import {
  verifyPreAuthToken,
  createSessionToken,
  SESSION_COOKIE,
  PREAUTH_COOKIE,
  sessionCookieOptions,
  preAuthCookieOptions,
} from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { consumeBackupCode } from "@/lib/totp-user";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ code: z.string().min(4).max(20) });

// Login akışının 2. adımı: /api/auth/login şifreyi doğrulayıp PREAUTH_COOKIE
// verdikten sonra, kullanıcı TOTP kodunu (veya bir yedek kurtarma kodunu)
// buraya gönderir. Doğrulanırsa gerçek SESSION_COOKIE verilir ve
// PREAUTH_COOKIE temizlenir.
export async function POST(req: Request) {
  const store = await cookies();
  const preAuthToken = store.get(PREAUTH_COOKIE)?.value;
  if (!preAuthToken) return NextResponse.json({ error: "no_pending_login" }, { status: 400 });

  const userId = await verifyPreAuthToken(preAuthToken);
  if (!userId) return NextResponse.json({ error: "pending_login_expired" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !user.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: "totp_not_enabled" }, { status: 400 });
  }

  const code = parsed.data.code.trim();
  const isTotpValid = verifyTotp(user.totpSecret, code);
  const isBackupValid = !isTotpValid && consumeBackupCode(user.id, code);
  if (!isTotpValid && !isBackupValid) {
    logAudit(user.id, "login.totp_failed");
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  const token = await createSessionToken({
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    aiDevAccess: !!user.aiDevAccess,
  });

  logAudit(user.id, isBackupValid ? "login.backup_code" : "login");

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.set(PREAUTH_COOKIE, "", { ...preAuthCookieOptions(), maxAge: 0 });
  return res;
}
