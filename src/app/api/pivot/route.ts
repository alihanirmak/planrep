import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims, getModelTenantId, rootMembers } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { buildFactWhereVariants, sumGroupedRows, MAX_AGGREGATE_RESULT_ROWS } from "@/lib/fact-filters";
import { formatT } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n-server";
import { cached, hashCacheParams } from "@/lib/cache";
import { listEffectiveMeasures, valueColumnForSlot } from "@/lib/model-measures";
import { computeJoinValues } from "@/lib/cross-model-join";

const joinDefSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  modelId: z.number().int(),
  measureCode: z.string().max(40).optional(),
  via: z.enum(["dimension", "attribute"]),
  attributeCode: z.string().max(40).optional(),
  targetDim: z.string().min(1),
});

const bodySchema = z.object({
  modelId: z.number().int(),
  rows: z.array(z.string()).min(1).max(3),
  cols: z.array(z.string()).min(1).max(2),
  filters: z.record(z.string(), z.array(z.string())).default({}),
  page: z.number().int().min(0).optional(),
  pageSize: z.number().int().min(1).max(1000).optional(),
  measureCode: z.string().max(40).optional(),
  joins: z.array(joinDefSchema).max(3).optional(),
});

// Pivot sonuclari (facts tablosu uzerinde agir GROUP BY/SUM) kisa sureli
// (60sn) cache'lenir — bkz. lib/cache.ts. Anahtar session.id'yi de icerir
// cunku sonuc kullanicinin veri erisim kisitlarina (allowedSets) gore
// degisir; iki farkli kullanicinin aslinda farkli gorebilecegi sonuclari
// yanlislikla paylasmamak icin bu sart. Yazma yollarinda (upsertFacts/
// revertUpload) modelId bazli invalidation yapilir (bkz. lib/facts-write.ts).
const PIVOT_CACHE_TTL_SECONDS = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { modelId, rows, cols, filters, page, pageSize, measureCode, joins } = parsed.data;
  if (getModelTenantId(modelId) !== session.tenantId) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }
  // Guvenlik: join hedefi baska bir tenant'a ait bir model OLAMAZ — aksi
  // halde bir kullanici, baska bir tenant'in verisini "join" uzerinden
  // sizdirabilirdi (bkz. getModelTenantId'nin 404 donme kurali, 403 degil).
  if (joins?.some((j) => getModelTenantId(j.modelId) !== session.tenantId)) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }

  const dims = getModelDims(modelId);
  const axis = [...rows, ...cols];
  if (new Set(axis).size !== axis.length) {
    return NextResponse.json({ error: "duplicate_dims" }, { status: 400 });
  }
  if (rows.some((c) => !dims.some((d) => d.code === c)) || cols.some((c) => !dims.some((d) => d.code === c))) {
    return NextResponse.json({ error: "invalid_dims" }, { status: 400 });
  }

  const cacheKey = `pivot:v1:${modelId}:${session.id}:${hashCacheParams({ rows, cols, filters, page, pageSize, measureCode, joins })}`;
  const body = await cached(cacheKey, PIVOT_CACHE_TTL_SECONDS, () =>
    computePivot(session.id, modelId, rows, cols, filters, page, pageSize, measureCode, joins)
  );
  if ("error" in body) {
    if (body.error === "result_too_large") {
      const { t } = await getServerT();
      return NextResponse.json(
        { ...body, message: formatT(t("err.resultTooLargeCount"), { count: body.count, max: MAX_AGGREGATE_RESULT_ROWS }) },
        { status: 400 }
      );
    }
    return NextResponse.json(body, { status: 400 });
  }
  return NextResponse.json(body);
}

type PivotComputeResult =
  | {
      tuples: Array<{ r: string[]; c: string[]; v: number }>;
      pagination?: { page: number; pageSize: number; totalRoots: number };
      joinValues?: Record<string, Record<string, number>>;
    }
  | { error: "result_too_large"; count: number };

function computePivot(
  userId: number,
  modelId: number,
  rows: string[],
  cols: string[],
  filters: Record<string, string[]>,
  page: number | undefined,
  pageSize: number | undefined,
  measureCode?: string,
  joins?: Array<z.infer<typeof joinDefSchema>>
): PivotComputeResult {
  const dims = getModelDims(modelId);
  const rowD = rows.map((c) => dims.find((d) => d.code === c));
  const colD = cols.map((c) => dims.find((d) => d.code === c));
  const measures = listEffectiveMeasures(modelId);
  const measure =
    (measureCode ? measures.find((m) => m.code === measureCode) : undefined) ??
    measures.find((m) => m.slot === 1) ??
    measures[0];
  const valueCol = valueColumnForSlot(measure.slot);

  // Sayfalama: ilk satir boyutunun (rows[0]) kok uyeleri sayfalanir, sayfaya
  // secilen kok uyelerin TUM alt agaci dahil edilir — boylece client'ta
  // createPivotEngine ile kurulan agacin satir toplamlari her zaman dogru
  // kalir (sadece hangi kok uyelerin gosterildigi sinirlanir). colTotals/
  // grandTotal (createPivotEngine'da donen tuples'tan hesaplanir) bu durumda
  // SADECE o sayfanin verisini yansitir — /api/query ile ayni semantik.
  const firstRowDim = rowD[0]!;
  const allRoots = rootMembers(firstRowDim.members);
  const pagination = page != null && pageSize != null ? { page, pageSize } : undefined;
  const pageRoots = pagination ? allRoots.slice(page! * pageSize!, (page! + 1) * pageSize!) : allRoots;
  let effectiveFilters = filters;
  if (pagination) {
    const pageRootCodes = pageRoots.map((m) => m.code);
    const existing = filters[firstRowDim.code];
    const rowCodes =
      existing && existing.length > 0 ? pageRootCodes.filter((c) => existing.includes(c)) : pageRootCodes;
    effectiveFilters = { ...filters, [firstRowDim.code]: rowCodes };
  }

  const access = allowedSets(userId, dims);
  const { variants, empty } = buildFactWhereVariants(modelId, dims, effectiveFilters, access);
  if (empty) {
    return {
      tuples: [],
      ...(pagination ? { pagination: { page: page!, pageSize: pageSize!, totalRoots: allRoots.length } } : {}),
    };
  }

  const rowSel = rowD.map((d, i) => `d${d!.slot} AS r${i}`).join(", ");
  const colSel = colD.map((d, i) => `d${d!.slot} AS c${i}`).join(", ");
  const groupBy = [
    ...rowD.map((d) => `d${d!.slot}`),
    ...colD.map((d) => `d${d!.slot}`),
  ].join(", ");
  const partials = variants.map(
    (v) =>
      sqlite
        .prepare(
          `SELECT ${rowSel}, ${colSel}, SUM(${valueCol}) AS v
           FROM facts WHERE ${v.sql} GROUP BY ${groupBy}`
        )
        .all(...v.params) as Array<Record<string, unknown>>
  );
  const keyFields = [...rowD.map((_, i) => `r${i}`), ...colD.map((_, i) => `c${i}`)];
  const raw = sumGroupedRows(partials, keyFields);
  if (raw.length > MAX_AGGREGATE_RESULT_ROWS) {
    return { error: "result_too_large", count: raw.length };
  }

  const tuples = raw.map((row) => ({
    r: rows.map((_, i) => String(row[`r${i}`])),
    c: cols.map((_, i) => String(row[`c${i}`])),
    v: Number(row.v),
  }));

  // Coklu-model join: SADECE rows[0] uzerinden hesaplanir (bkz.
  // lib/cross-model-join.ts) — pivot.ts'teki PivotViewRow.path[0] her
  // zaman rows[0] boyutunun kendi uye kodu oldugundan, bu tek bir
  // Record<rows[0] kodu, deger> ile UI'daki her derinlikteki satiri
  // dogru besler.
  let joinValues: Record<string, Record<string, number>> | undefined;
  if (joins && joins.length > 0) {
    joinValues = {};
    for (const j of joins) {
      joinValues[j.id] = computeJoinValues(modelId, rows[0], j, userId);
    }
  }

  return {
    tuples,
    ...(pagination ? { pagination: { page: page!, pageSize: pageSize!, totalRoots: allRoots.length } } : {}),
    ...(joinValues ? { joinValues } : {}),
  };
}
