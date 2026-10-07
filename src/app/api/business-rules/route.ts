import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { listBusinessRules, createBusinessRule } from "@/lib/business-rules";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const modelIdParam = searchParams.get("modelId");
  const rules = listBusinessRules({
    tenantId: session.tenantId,
    modelId: modelIdParam ? Number(modelIdParam) : undefined,
  });
  return NextResponse.json(rules);
}

const createSchema = z.object({
  modelId: z.number().int(),
  name: z.string().min(1).max(160),
  scopeFilters: z.record(z.string(), z.array(z.string())).default({}),
  op: z.enum(["<", ">", "<=", ">=", "=", "<>"]),
  value: z.number(),
  measureCode: z.string().max(40).nullish(),
  severity: z.enum(["block", "warn"]).default("block"),
  message: z.string().max(300).nullish(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const model = sqlite
    .prepare("SELECT id FROM models WHERE id = ? AND tenant_id = ?")
    .get(parsed.data.modelId, session.tenantId);
  if (!model) return NextResponse.json({ error: "model_not_found" }, { status: 404 });

  const rule = createBusinessRule({ ...parsed.data, tenantId: session.tenantId });
  logAudit(session.id, "business_rule.create", "business_rule", rule.id, parsed.data);
  return NextResponse.json(rule, { status: 201 });
}
