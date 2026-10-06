import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFactAuditEntry, rollbackFactAudit, FactAuditNotFoundError } from "@/lib/fact-audit";
import { WorkflowLockError } from "@/lib/workflow";
import { BusinessRuleError } from "@/lib/business-rules";
import { logAudit } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const entry = getFactAuditEntry(id);
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    rollbackFactAudit(id, session.id);
  } catch (e) {
    if (e instanceof FactAuditNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (e instanceof WorkflowLockError) {
      return NextResponse.json({ error: "workflow_locked", message: e.message }, { status: 423 });
    }
    if (e instanceof BusinessRuleError) {
      return NextResponse.json({ error: "business_rule_violated", message: e.message }, { status: 400 });
    }
    throw e;
  }

  logAudit(session.id, "fact_audit.rollback", "fact_audit", id, {
    modelId: entry.modelId,
    coords: entry.coords,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
  });
  return NextResponse.json({ ok: true });
}
