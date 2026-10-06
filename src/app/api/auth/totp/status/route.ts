import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTotpStatus, remainingBackupCodeCount } from "@/lib/totp-user";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = getTotpStatus(session.id);
  return NextResponse.json({ ...status, remainingBackupCodes: remainingBackupCodeCount(session.id) });
}
