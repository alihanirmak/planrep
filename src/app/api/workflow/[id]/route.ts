import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  getWorkflowItem,
  getWorkflowHistory,
  updateWorkflowItem,
  deleteWorkflowItem,
} from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { getServerT } from "@/lib/i18n-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const item = getWorkflowItem(id);
  if (!item || item.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const history = getWorkflowHistory(id);
  return NextResponse.json({ ...item, history });
}

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  scopeFilters: z.record(z.string(), z.array(z.string())).optional(),
  approverId: z.number().int().nullish(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const item = getWorkflowItem(id);
  if (!item || item.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (item.status !== "draft") {
    const { t } = await getServerT();
    return NextResponse.json(
      { error: "not_editable", message: t("err.workflowOnlyDraftEditable") },
      { status: 400 }
    );
  }
  if (session.role !== "admin" && session.id !== item.ownerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const updated = updateWorkflowItem(id, parsed.data);
  logAudit(session.id, "workflow.update", "workflow", id, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const item = getWorkflowItem(id);
  if (!item || item.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (item.status !== "draft") {
    return NextResponse.json(
      { error: "not_deletable", message: "Sadece 'draft' durumundaki iş akışları silinebilir" },
      { status: 400 }
    );
  }
  if (session.role !== "admin" && session.id !== item.ownerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  deleteWorkflowItem(id);
  logAudit(session.id, "workflow.delete", "workflow", id, { name: item.name });
  return NextResponse.json({ ok: true });
}
