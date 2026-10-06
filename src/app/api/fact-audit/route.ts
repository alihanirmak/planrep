import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listFactAudit } from "@/lib/fact-audit";
import { getModelTenantId } from "@/lib/model";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const modelId = Number(searchParams.get("modelId"));
  if (!modelId) return NextResponse.json({ error: "model_required" }, { status: 400 });
  if (getModelTenantId(modelId) !== session.tenantId) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }

  const coordsParam = searchParams.get("coords"); // JSON: Record<dimCode,string>
  const uploadIdParam = searchParams.get("uploadId");
  const limitParam = searchParams.get("limit");

  let coordsByDimCode: Record<string, string> | undefined;
  if (coordsParam) {
    try {
      coordsByDimCode = JSON.parse(coordsParam);
    } catch {
      return NextResponse.json({ error: "invalid_coords" }, { status: 400 });
    }
  }

  const entries = listFactAudit(modelId, {
    coordsByDimCode,
    uploadId: uploadIdParam ? Number(uploadIdParam) : undefined,
    limit: limitParam ? Number(limitParam) : undefined,
  });
  return NextResponse.json(entries);
}
