import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getModelTenantId } from "@/lib/model";
import {
  getModelMeasures,
  createModelMeasure,
  MeasureLimitError,
  MAX_MODEL_MEASURES,
} from "@/lib/model-measures";
import { logAudit } from "@/lib/audit";

// Model olculeri (measures) CRUD — model_dimensions/attributes API'leriyle
// AYNI desen. GET sadece GERCEK (DB'de tanimli) olculeri doner (sanal
// varsayilan "VALUE" olcusu GOSTERILMEZ — UI'nin "henuz hic olcu
// tanimlanmadi" durumunu "VALUE" diye sahte bir satirla karistirmasini
// onlemek icin; bkz. lib/model-measures.ts listEffectiveMeasures).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const modelId = parseIdParam((await params).id);
  if (modelId === null) return invalidIdResponse();

  if (getModelTenantId(modelId) !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(getModelMeasures(modelId));
}

const createSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Za-z0-9_]+$/),
  name: z.string().min(1).max(120),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const modelId = parseIdParam((await params).id);
  if (modelId === null) return invalidIdResponse();

  if (getModelTenantId(modelId) !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { code, name } = parsed.data;

  const existing = getModelMeasures(modelId);
  if (existing.some((m) => m.code === code)) {
    return NextResponse.json({ error: "code_exists" }, { status: 409 });
  }
  if (existing.length >= MAX_MODEL_MEASURES) {
    return NextResponse.json(
      { error: "measure_limit", message: `Bir modele en fazla ${MAX_MODEL_MEASURES} ölçü eklenebilir` },
      { status: 400 }
    );
  }

  let measure;
  try {
    measure = createModelMeasure({ modelId, code, name });
  } catch (e) {
    if (e instanceof MeasureLimitError) {
      return NextResponse.json({ error: "measure_limit", message: e.message }, { status: 400 });
    }
    throw e;
  }
  logAudit(session.id, "model_measure.create", "model", modelId, { code, name });
  return NextResponse.json(measure, { status: 201 });
}
