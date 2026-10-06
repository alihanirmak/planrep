import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims, getModelTenantId, rootMembers } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { buildFactWhereVariants, sumGroupedRows, MAX_AGGREGATE_RESULT_ROWS } from "@/lib/fact-filters";
import { formatT } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n-server";

const bodySchema = z.object({
  modelId: z.number().int(),
  rows: z.array(z.string()).min(1).max(3),
  cols: z.array(z.string()).min(1).max(2),
  filters: z.record(z.string(), z.array(z.string())).default({}),
  page: z.number().int().min(0).optional(),
  pageSize: z.number().int().min(1).max(1000).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { modelId, rows, cols, filters, page, pageSize } = parsed.data;
  if (getModelTenantId(modelId) !== session.tenantId) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }

  const dims = getModelDims(modelId);
  const axis = [...rows, ...cols];
  if (new Set(axis).size !== axis.length) {
    return NextResponse.json({ error: "duplicate_dims" }, { status: 400 });
  }
  const rowD = rows.map((c) => dims.find((d) => d.code === c));
  const colD = cols.map((c) => dims.find((d) => d.code === c));
  if (rowD.some((d) => !d) || colD.some((d) => !d)) {
    return NextResponse.json({ error: "invalid_dims" }, { status: 400 });
  }

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

  const access = allowedSets(session.id, dims);
  const { variants, empty } = buildFactWhereVariants(modelId, dims, effectiveFilters, access);
  if (empty) {
    return NextResponse.json({
      tuples: [],
      ...(pagination ? { pagination: { page, pageSize, totalRoots: allRoots.length } } : {}),
    });
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
          `SELECT ${rowSel}, ${colSel}, SUM(value) AS v
           FROM facts WHERE ${v.sql} GROUP BY ${groupBy}`
        )
        .all(...v.params) as Array<Record<string, unknown>>
  );
  const keyFields = [...rowD.map((_, i) => `r${i}`), ...colD.map((_, i) => `c${i}`)];
  const raw = sumGroupedRows(partials, keyFields);
  if (raw.length > MAX_AGGREGATE_RESULT_ROWS) {
    const { t } = await getServerT();
    return NextResponse.json(
      {
        error: "result_too_large",
        message: formatT(t("err.resultTooLargeCount"), { count: raw.length, max: MAX_AGGREGATE_RESULT_ROWS }),
      },
      { status: 400 }
    );
  }

  const tuples = raw.map((row) => ({
    r: rows.map((_, i) => String(row[`r${i}`])),
    c: cols.map((_, i) => String(row[`c${i}`])),
    v: Number(row.v),
  }));

  return NextResponse.json({
    tuples,
    ...(pagination ? { pagination: { page, pageSize, totalRoots: allRoots.length } } : {}),
  });
}
