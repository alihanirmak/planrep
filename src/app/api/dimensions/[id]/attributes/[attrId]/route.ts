import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getDimensionAttribute, updateDimensionAttribute, deleteDimensionAttribute } from "@/lib/dimension-attributes";
import { logAudit } from "@/lib/audit";

async function loadOwnedAttribute(dimensionId: number, attrId: number, tenantId: number) {
  const dim = sqlite.prepare("SELECT id FROM dimensions WHERE id = ? AND tenant_id = ?").get(dimensionId, tenantId);
  if (!dim) return null;
  const attr = getDimensionAttribute(attrId);
  if (!attr || attr.dimensionId !== dimensionId) return null;
  return attr;
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  orderIdx: z.number().int().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; attrId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: idRaw, attrId: attrIdRaw } = await params;
  const dimensionId = parseIdParam(idRaw);
  const attrId = parseIdParam(attrIdRaw);
  if (dimensionId === null || attrId === null) return invalidIdResponse();

  const attr = await loadOwnedAttribute(dimensionId, attrId, session.tenantId);
  if (!attr) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const updated = updateDimensionAttribute(attrId, parsed.data);
  logAudit(session.id, "dimension_attribute.update", "dimension_attribute", attrId, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; attrId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: idRaw, attrId: attrIdRaw } = await params;
  const dimensionId = parseIdParam(idRaw);
  const attrId = parseIdParam(attrIdRaw);
  if (dimensionId === null || attrId === null) return invalidIdResponse();

  const attr = await loadOwnedAttribute(dimensionId, attrId, session.tenantId);
  if (!attr) return NextResponse.json({ error: "not_found" }, { status: 404 });

  deleteDimensionAttribute(attrId);
  logAudit(session.id, "dimension_attribute.delete", "dimension_attribute", attrId, { code: attr.code });
  return NextResponse.json({ ok: true });
}
