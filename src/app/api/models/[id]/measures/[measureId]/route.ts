import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getModelTenantId } from "@/lib/model";
import { getMeasure, updateMeasure, deleteModelMeasure, MeasureInUseError, PrimaryMeasureInUseError } from "@/lib/model-measures";
import { logAudit } from "@/lib/audit";

async function loadOwnedMeasure(modelId: number, measureId: number, tenantId: number) {
  if (getModelTenantId(modelId) !== tenantId) return null;
  const measure = getMeasure(measureId);
  if (!measure || measure.modelId !== modelId) return null;
  return measure;
}

const patchSchema = z.object({
  name: z.string().min(1).max(120),
});

// code/slot KASITLI OLARAK degistirilemez (bkz. lib/model-measures.ts) —
// var olan facts.value{slot} kolonundaki verinin anlamini degistirmemek icin.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; measureId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: idRaw, measureId: measureIdRaw } = await params;
  const modelId = parseIdParam(idRaw);
  const measureId = parseIdParam(measureIdRaw);
  if (modelId === null || measureId === null) return invalidIdResponse();

  const measure = await loadOwnedMeasure(modelId, measureId, session.tenantId);
  if (!measure) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const updated = updateMeasure(measureId, parsed.data);
  logAudit(session.id, "model_measure.update", "model_measure", measureId, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; measureId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: idRaw, measureId: measureIdRaw } = await params;
  const modelId = parseIdParam(idRaw);
  const measureId = parseIdParam(measureIdRaw);
  if (modelId === null || measureId === null) return invalidIdResponse();

  const measure = await loadOwnedMeasure(modelId, measureId, session.tenantId);
  if (!measure) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    deleteModelMeasure(measureId);
  } catch (e) {
    if (e instanceof MeasureInUseError) {
      return NextResponse.json({ error: "measure_in_use", message: e.message }, { status: 400 });
    }
    if (e instanceof PrimaryMeasureInUseError) {
      return NextResponse.json({ error: "primary_measure_in_use", message: e.message }, { status: 400 });
    }
    throw e;
  }
  logAudit(session.id, "model_measure.delete", "model_measure", measureId, { code: measure.code });
  return NextResponse.json({ ok: true });
}
