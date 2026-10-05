import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSession, sessionCookieOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function POST() {
  const session = await getSession();
  if (session) logAudit(session.id, "logout");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0) });
  return res;
}
