import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runQuery } from "@/lib/query";
import { MAX_AGGREGATE_RESULT_ROWS } from "@/lib/fact-filters";

const bodySchema = z.object({
  modelId: z.number().int(),
  rowDim: z.string(),
  colDim: z.string(),
  filters: z.record(z.string(), z.array(z.string())).default({}),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { modelId, rowDim, colDim, filters } = parsed.data;
  const result = runQuery(modelId, rowDim, colDim, filters, session.id);
  if ("error" in result) {
    const message =
      result.error === "result_too_large"
        ? `Sonuç seti çok büyük (üst sınır: ${MAX_AGGREGATE_RESULT_ROWS} hücre). Lütfen filtre ekleyin.`
        : undefined;
    return NextResponse.json({ ...result, message }, { status: 400 });
  }
  return NextResponse.json(result);
}
