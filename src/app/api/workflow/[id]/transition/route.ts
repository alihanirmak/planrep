import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getWorkflowItem, canTransition, applyTransition, type WorkflowItem } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { createNotifications } from "@/lib/notifications";

const schema = z.object({
  action: z.enum(["submit", "review", "approve", "reject", "lock", "reopen"]),
  comment: z.string().max(500).nullish(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = parseIdParam((await params).id);

  if (id === null) return invalidIdResponse();
  const item = getWorkflowItem(id);
  if (!item || item.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { action, comment } = parsed.data;

  const check = canTransition(item, action, session, comment);
  if (!check.ok) {
    const status = check.error === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: check.error }, { status });
  }

  const updated = applyTransition(item, check.rule, session.id, comment);
  logAudit(session.id, `workflow.${action}`, "workflow", id, { comment, from: item.status, to: updated.status });
  notifyTransitionRecipients(updated, action, session.id);
  return NextResponse.json(updated);
}

// Onaylama akisinda ilgili taraflara bildirim gonderir: submit -> atanmis
// onaylayana (varsa), approve/reject -> is akisi sahibine (kendi islemiyse
// bildirim gondermez).
function notifyTransitionRecipients(
  item: WorkflowItem,
  action: z.infer<typeof schema>["action"],
  actorId: number
) {
  const link = `/workflow/${item.id}`;
  const params = { workflowName: item.name };
  if (action === "submit" && item.approverId != null && item.approverId !== actorId) {
    createNotifications([item.approverId], "workflow_review_needed", params, link);
  } else if (action === "approve" && item.ownerId !== actorId) {
    createNotifications([item.ownerId], "workflow_approved", params, link);
  } else if (action === "reject" && item.ownerId !== actorId) {
    createNotifications([item.ownerId], "workflow_rejected", params, link);
  }
}
