import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { devPlanSchema, runPlan, type PlanContext } from "@/lib/ai/dev-actions";
import { hasLiveAiDevAccess, aiDevActionsToday, MAX_AI_DEV_ACTIONS_PER_DAY } from "@/lib/ai/dev-permission";

// Kullanicinin onizlemeyi gorup ACIKCA onayladigi planı GERCEKTEN uygular
// (dryRun=false) — her eylem kendi REST route'uyla AYNI dogrulama/limit/rol
// kontrolunden gecer (bkz. lib/ai/dev-actions.ts). Guvenlik: aiDevAccess
// burada da (plan ucunda da yapildigi gibi) CANLI olarak kontrol edilir —
// plan onizlendikten sonra erisim geri alinmis olabilir.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasLiveAiDevAccess(session)) {
    return NextResponse.json({ error: "forbidden", message: "AI ile geliştirme erişiminiz yok" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = devPlanSchema.safeParse(body?.plan);
  if (!parsed.success) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

  const already = aiDevActionsToday(session.tenantId);
  if (already + parsed.data.actions.length > MAX_AI_DEV_ACTIONS_PER_DAY) {
    return NextResponse.json(
      {
        error: "daily_limit_exceeded",
        message: `Tenant başına günlük AI ile geliştirme eylem sınırı (${MAX_AI_DEV_ACTIONS_PER_DAY}) aşılıyor`,
      },
      { status: 429 }
    );
  }

  const ctx: PlanContext = { tenantId: session.tenantId, userId: session.id, role: session.role };
  const results = await runPlan(parsed.data, ctx, false);
  return NextResponse.json({ results });
}
