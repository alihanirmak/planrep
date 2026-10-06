import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { getSession } from "@/lib/auth";
import { revokeApiKey } from "@/lib/api-keys";
import { logAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const ok = revokeApiKey(session.tenantId, session.id, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logAudit(session.id, "api_key.revoke", "api_key", id);
  return NextResponse.json({ ok: true });
}
