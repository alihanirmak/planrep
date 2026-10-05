import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runQuery } from "@/lib/query";

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
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
