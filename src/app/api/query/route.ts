import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runQuery } from "@/lib/query";
import { getModelTenantId } from "@/lib/model";
import { MAX_AGGREGATE_RESULT_ROWS } from "@/lib/fact-filters";
import { formatT } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n-server";
import { cached, hashCacheParams } from "@/lib/cache";

const bodySchema = z.object({
  modelId: z.number().int(),
  rowDim: z.string(),
  colDim: z.string(),
  filters: z.record(z.string(), z.array(z.string())).default({}),
  page: z.number().int().min(0).optional(),
  pageSize: z.number().int().min(1).max(1000).optional(),
});

// Pivot ile ayni cache stratejisi (bkz. api/pivot/route.ts ustundeki not):
// kisa sureli (60sn) + session.id'ye bagli (kullanici bazli veri erisim
// kisitlari sonucu degistirir) + yazma yollarinda modelId bazli invalidation.
const QUERY_CACHE_TTL_SECONDS = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { modelId, rowDim, colDim, filters, page, pageSize } = parsed.data;
  if (getModelTenantId(modelId) !== session.tenantId) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }
  const pagination = page != null && pageSize != null ? { page, pageSize } : undefined;
  const cacheKey = `query:v1:${modelId}:${session.id}:${hashCacheParams({ rowDim, colDim, filters, page, pageSize })}`;
  const result = await cached(cacheKey, QUERY_CACHE_TTL_SECONDS, () =>
    runQuery(modelId, rowDim, colDim, filters, session.id, pagination)
  );
  if ("error" in result) {
    let message: string | undefined;
    if (result.error === "result_too_large") {
      const { t } = await getServerT();
      message = formatT(t("err.resultTooLarge"), { max: MAX_AGGREGATE_RESULT_ROWS });
    }
    return NextResponse.json({ ...result, message }, { status: 400 });
  }
  return NextResponse.json(result);
}
