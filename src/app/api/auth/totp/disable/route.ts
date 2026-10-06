import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { disableTotp } from "@/lib/totp-user";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ password: z.string().min(1) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const result = disableTotp(session.id, parsed.data.password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  logAudit(session.id, "totp.disable");
  return NextResponse.json({ ok: true });
}
