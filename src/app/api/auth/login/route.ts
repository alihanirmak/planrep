import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import {
  checkPassword,
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
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

  const token = await createSessionToken({
    id: user.id,
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
