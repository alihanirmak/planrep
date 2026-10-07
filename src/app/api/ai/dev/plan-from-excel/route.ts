import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getModels } from "@/lib/model";
import { hasLiveAiDevAccess } from "@/lib/ai/dev-permission";
import { parseExcelToDevPlan } from "@/lib/ai/dev-excel";
import { runPlan, type PlanContext } from "@/lib/ai/dev-actions";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Excel sablonundan DETERMINISTIK (LLM gerektirmeyen) bir plan cikarir ve
// ONIZLER — /api/ai/dev/plan ile AYNI onizleme/onay semantigine sahiptir,
// HICBIR SEY DB'YE YAZILMAZ.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasLiveAiDevAccess(session)) {
    return NextResponse.json({ error: "forbidden", message: "AI ile geliştirme erişiminiz yok" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const modelCodeHint = form?.get("modelCode");
  const modelNameHint = form?.get("modelName");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const existingModels = getModels(session.tenantId);
  const result = await parseExcelToDevPlan(await file.arrayBuffer(), {
    modelCodeHint: typeof modelCodeHint === "string" ? modelCodeHint : undefined,
    modelNameHint: typeof modelNameHint === "string" ? modelNameHint : undefined,
    existingModels,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const ctx: PlanContext = { tenantId: session.tenantId, userId: session.id, role: session.role };
  const results = runPlan(result.plan, ctx, true);
  return NextResponse.json({ plan: result.plan, results, source: "excel" });
}
