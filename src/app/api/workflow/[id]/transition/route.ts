import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getWorkflowItem, canTransition, applyTransition } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

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

  const id = Number((await params).id);
  const item = getWorkflowItem(id);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

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
  return NextResponse.json(updated);
}
