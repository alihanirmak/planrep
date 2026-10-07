import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getModels, MAX_MODEL_DIMENSIONS } from "@/lib/model";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getServerT } from "@/lib/i18n-server";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(getModels(session.tenantId));
}

const createSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Za-z0-9_]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  dimensionIds: z.array(z.number().int()).min(1).max(MAX_MODEL_DIMENSIONS),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { code, name, description, dimensionIds } = parsed.data;
  const upper = code.toUpperCase();

  if (new Set(dimensionIds).size !== dimensionIds.length) {
    return NextResponse.json({ error: "duplicate_dims" }, { status: 400 });
  }
  const exists = sqlite.prepare("SELECT id FROM models WHERE code = ?").get(upper);
  if (exists) return NextResponse.json({ error: "code_exists" }, { status: 409 });
  for (const dimId of dimensionIds) {
    const dim = sqlite
      .prepare(
        "SELECT id, visibility, owner_model_id AS ownerModelId FROM dimensions WHERE id = ? AND tenant_id = ?"
      )
      .get(dimId, session.tenantId) as
      | { id: number; visibility: string; ownerModelId: number | null }
      | undefined;
    if (!dim) {
      return NextResponse.json({ error: "dimension_not_found" }, { status: 400 });
    }
    if (dim.visibility === "private" && dim.ownerModelId != null) {
      const { t } = await getServerT();
      return NextResponse.json(
        { error: "private_dim_taken", message: t("err.privateDimTaken") },
        { status: 400 }
      );
    }
  }

  let modelId = 0;
  const tx = sqlite.transaction(() => {
    modelId = Number(
      sqlite
        .prepare("INSERT INTO models (tenant_id, code, name, description, created_at) VALUES (?,?,?,?,?)")
        .run(session.tenantId, upper, name, description ?? null, new Date().toISOString()).lastInsertRowid
    );
    const ins = sqlite.prepare(
      "INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)"
    );
    dimensionIds.forEach((dimId, i) => ins.run(modelId, dimId, i + 1));
    // Sahipsiz private boyutlar bu modele baglanir
    sqlite
      .prepare(
        `UPDATE dimensions SET owner_model_id = ?
         WHERE visibility = 'private' AND owner_model_id IS NULL
           AND id IN (${dimensionIds.map(() => "?").join(",")})`
      )
      .run(modelId, ...dimensionIds);
  });
  tx();

  logAudit(session.id, "model.create", "model", modelId, { code: upper, name, dimensionIds });
  return NextResponse.json({ id: modelId }, { status: 201 });
}
