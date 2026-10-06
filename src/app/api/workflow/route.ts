import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { listWorkflowItems, createWorkflowItem, type WorkflowStatus } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

function withUserNames<T extends { ownerId: number; approverId: number | null }>(items: T[]) {
  const ids = [...new Set(items.flatMap((i) => [i.ownerId, i.approverId].filter((x): x is number => x != null)))];
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const rows = sqlite
      .prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as Array<{ id: number; name: string }>;
    for (const r of rows) names.set(r.id, r.name);
  }
  return items.map((i) => ({
    ...i,
    ownerName: names.get(i.ownerId) ?? null,
    approverName: i.approverId != null ? names.get(i.approverId) ?? null : null,
  }));
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const modelIdParam = searchParams.get("modelId");
  const statusParam = searchParams.get("status") as WorkflowStatus | null;
  const items = listWorkflowItems({
    modelId: modelIdParam ? Number(modelIdParam) : undefined,
    status: statusParam ?? undefined,
  });
  return NextResponse.json(withUserNames(items));
}

const createSchema = z.object({
  modelId: z.number().int(),
  name: z.string().min(1).max(160),
  scopeFilters: z.record(z.string(), z.array(z.string())).default({}),
  approverId: z.number().int().nullish(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { modelId, name, scopeFilters, approverId } = parsed.data;

  const model = sqlite.prepare("SELECT id FROM models WHERE id = ?").get(modelId);
  if (!model) return NextResponse.json({ error: "model_not_found" }, { status: 404 });

  const item = createWorkflowItem({ modelId, name, scopeFilters, ownerId: session.id, approverId });
  logAudit(session.id, "workflow.create", "workflow", item.id, { modelId, name, scopeFilters });
  return NextResponse.json(item, { status: 201 });
}
