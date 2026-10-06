import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getBusinessRule, updateBusinessRule, deleteBusinessRule } from "@/lib/business-rules";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  scopeFilters: z.record(z.string(), z.array(z.string())).optional(),
  op: z.enum(["<", ">", "<=", ">=", "=", "<>"]).optional(),
  value: z.number().optional(),
  severity: z.enum(["block", "warn"]).optional(),
  message: z.string().max(300).nullish(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const existing = getBusinessRule(id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const updated = updateBusinessRule(id, parsed.data);
  logAudit(session.id, "business_rule.update", "business_rule", id, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const existing = getBusinessRule(id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  deleteBusinessRule(id);
  logAudit(session.id, "business_rule.delete", "business_rule", id, { name: existing.name });
  return NextResponse.json({ ok: true });
}
