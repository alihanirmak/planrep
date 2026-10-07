import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { listDimensionAttributesWithMeta, createDimensionAttribute } from "@/lib/dimension-attributes";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dimensionId = parseIdParam((await params).id);
  if (dimensionId === null) return invalidIdResponse();

  const dim = sqlite
    .prepare("SELECT id FROM dimensions WHERE id = ? AND tenant_id = ?")
    .get(dimensionId, session.tenantId);
  if (!dim) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(listDimensionAttributesWithMeta(dimensionId));
}

const createSchema = z.object({
  code: z.string().min(1).max(60).regex(/^[A-Za-z0-9_]+$/),
  name: z.string().min(1).max(120),
  type: z.enum(["text", "number", "date", "member_ref"]),
  refDimensionId: z.number().int().nullish(),
  orderIdx: z.number().int().default(0),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const dimensionId = parseIdParam((await params).id);
  if (dimensionId === null) return invalidIdResponse();

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { code, name, type, refDimensionId, orderIdx } = parsed.data;

  const dim = sqlite
    .prepare("SELECT id FROM dimensions WHERE id = ? AND tenant_id = ?")
    .get(dimensionId, session.tenantId);
  if (!dim) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (type === "member_ref") {
    if (refDimensionId == null) {
      return NextResponse.json({ error: "ref_dimension_required" }, { status: 400 });
    }
    const refDim = sqlite
      .prepare("SELECT id FROM dimensions WHERE id = ? AND tenant_id = ?")
      .get(refDimensionId, session.tenantId);
    if (!refDim) return NextResponse.json({ error: "ref_dimension_not_found" }, { status: 400 });
  }

  const exists = sqlite
    .prepare("SELECT id FROM dimension_attributes WHERE dimension_id = ? AND code = ?")
    .get(dimensionId, code);
  if (exists) return NextResponse.json({ error: "code_exists" }, { status: 409 });

  const attribute = createDimensionAttribute({
    dimensionId,
    code,
    name,
    type,
    refDimensionId,
    orderIdx,
  });
  logAudit(session.id, "dimension_attribute.create", "dimension", dimensionId, { code, name, type });
  return NextResponse.json(attribute, { status: 201 });
}
