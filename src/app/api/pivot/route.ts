import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { buildFactWhereVariants, sumGroupedRows } from "@/lib/fact-filters";

const bodySchema = z.object({
  modelId: z.number().int(),
  rows: z.array(z.string()).min(1).max(3),
  cols: z.array(z.string()).min(1).max(2),
  filters: z.record(z.string(), z.array(z.string())).default({}),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { modelId, rows, cols, filters } = parsed.data;

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

  const access = allowedSets(session.id, dims);
  const { variants, empty } = buildFactWhereVariants(modelId, dims, filters, access);
  if (empty) return NextResponse.json({ tuples: [] });

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

  const tuples = raw.map((row) => ({
    r: rows.map((_, i) => String(row[`r${i}`])),
    c: cols.map((_, i) => String(row[`c${i}`])),
    v: Number(row.v),
  }));

  return NextResponse.json({ tuples });
}
