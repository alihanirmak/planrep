import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import {
  checkPassword,
  createSessionToken,
  createPreAuthToken,
  SESSION_COOKIE,
  PREAUTH_COOKIE,
  sessionCookieOptions,
  preAuthCookieOptions,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !checkPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // 2FA aktifse once "sifre dogrulandi, TOTP bekleniyor" durumuna gecilir —
  // tam oturum (SESSION_COOKIE) HENUZ verilmez. Istemci /api/auth/login/totp'a
  // kodu gonderip oturumu tamamlar (bkz. src/app/login/page.tsx).
  if (user.totpEnabled) {
    const preAuthToken = await createPreAuthToken(user.id);
    const res = NextResponse.json({ requiresTotp: true });
    res.cookies.set(PREAUTH_COOKIE, preAuthToken, preAuthCookieOptions());
    return res;
  }

  const token = await createSessionToken({
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
  });

  logAudit(user.id, "login");

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
