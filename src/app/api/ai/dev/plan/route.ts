import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { hasLiveAiDevAccess } from "@/lib/ai/dev-permission";
import { planFromMessage } from "@/lib/ai/dev-planner";
import { runPlan, type PlanContext } from "@/lib/ai/dev-actions";

const bodySchema = z.object({ message: z.string().min(3).max(1000) });

// Sadece bir PLAN uretir ve ONIZLER — HICBIR SEY DB'YE YAZILMAZ (bkz.
// lib/ai/dev-actions.ts runPlan dryRun=true). Kullanici sonucu gorup
// /api/ai/dev/apply ile acikca onaylamadan hicbir model/boyut/olcu/rapor/
// veri olusturulmaz.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasLiveAiDevAccess(session)) {
    return NextResponse.json({ error: "forbidden", message: "AI ile geliştirme erişiminiz yok" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { plan, source, note } = await planFromMessage(parsed.data.message, session.tenantId);
  if (!plan) {
    return NextResponse.json({ error: "unresolvable", note }, { status: 422 });
  }

  const ctx: PlanContext = { tenantId: session.tenantId, userId: session.id, role: session.role };
  const results = await runPlan(plan, ctx, true);
  return NextResponse.json({ plan, results, source, note });
}
