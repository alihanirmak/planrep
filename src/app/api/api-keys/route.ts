import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(listApiKeys(session.tenantId, session.id));
}

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const created = createApiKey(session.tenantId, session.id, parsed.data.name);
  logAudit(session.id, "api_key.create", "api_key", created.id, { name: created.name });
  return NextResponse.json(created, { status: 201 });
}
