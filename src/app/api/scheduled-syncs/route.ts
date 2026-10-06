import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listScheduledSyncs, createScheduledSync } from "@/lib/scheduled-sync";
import { getModelDims, getModelTenantId } from "@/lib/model";
import { getConnectorConfig } from "@/lib/connector-configs";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(listScheduledSyncs({ tenantId: session.tenantId }));
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  connectorConfigId: z.number().int(),
  source: z.string().min(1),
  modelId: z.number().int(),
  mapping: z.record(z.string(), z.string()),
  intervalMinutes: z.number().int().min(5).max(10080), // 5 dakika .. 1 hafta
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { connectorConfigId, modelId } = parsed.data;

  const connectorConfig = getConnectorConfig(connectorConfigId);
  if (!connectorConfig || connectorConfig.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "connector_not_found" }, { status: 404 });
  }
  if (getModelTenantId(modelId) !== session.tenantId || getModelDims(modelId).length === 0) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }

  const created = createScheduledSync({ ...parsed.data, tenantId: session.tenantId, createdBy: session.id });
  logAudit(session.id, "scheduled_sync.create", "scheduled_sync", created.id, {
    name: created.name,
    intervalMinutes: created.intervalMinutes,
  });
  return NextResponse.json(created, { status: 201 });
}
