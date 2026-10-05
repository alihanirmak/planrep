import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims, withDescendants } from "@/lib/model";
import { allowedSets, restrictCodes } from "@/lib/access";

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
  const where: string[] = ["model_id = ?"];
  const params: unknown[] = [modelId];
  for (const d of dims) {
    const requested =
      filters[d.code] && filters[d.code].length > 0
        ? withDescendants(d.members, filters[d.code])
        : undefined;
    const codes = restrictCodes(requested, access.get(d.code));
    if (codes) {
      if (codes.length === 0) return NextResponse.json({ tuples: [] });
      where.push(`d${d.slot} IN (${codes.map(() => "?").join(",")})`);
      params.push(...codes);
    }
  }

  const rowSel = rowD.map((d, i) => `d${d!.slot} AS r${i}`).join(", ");
  const colSel = colD.map((d, i) => `d${d!.slot} AS c${i}`).join(", ");
  const groupBy = [
    ...rowD.map((d) => `d${d!.slot}`),
    ...colD.map((d) => `d${d!.slot}`),
  ].join(", ");
  const sql = `SELECT ${rowSel}, ${colSel}, SUM(value) AS v
               FROM facts WHERE ${where.join(" AND ")} GROUP BY ${groupBy}`;
  const raw = sqlite.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  const tuples = raw.map((row) => ({
    r: rows.map((_, i) => String(row[`r${i}`])),
    c: cols.map((_, i) => String(row[`c${i}`])),
    v: Number(row.v),
  }));

  return NextResponse.json({ tuples });
}
