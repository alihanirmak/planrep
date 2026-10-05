import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims, withDescendants } from "@/lib/model";
import { allowedSets, restrictCodes } from "@/lib/access";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  modelId: z.number().int(),
  filters: z.record(z.string(), z.array(z.string())).default({}),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(500).default(50),
});

function buildWhere(
  modelId: number,
  filters: Record<string, string[]>,
  userId: number
) {
  const dims = getModelDims(modelId);
  const access = allowedSets(userId, dims);
  const where: string[] = ["model_id = ?"];
  const params: unknown[] = [modelId];
  let empty = false;
  for (const d of dims) {
    const requested =
      filters[d.code] && filters[d.code].length > 0
        ? withDescendants(d.members, filters[d.code])
        : undefined;
    const codes = restrictCodes(requested, access.get(d.code));
    if (codes) {
      if (codes.length === 0) empty = true;
      where.push(`d${d.slot} IN (${codes.map(() => "?").join(",")})`);
      params.push(...codes);
    }
  }
  return { dims, where, params, empty };
}

// Veri gozatma / drill-through
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { modelId, filters, page, pageSize } = parsed.data;
  const { dims, where, params, empty } = buildWhere(modelId, filters, session.id);
  if (dims.length === 0) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }
  if (empty) {
    return NextResponse.json({ rows: [], total: 0, dims: dims.map((d) => d.code) });
  }

  const whereSql = where.join(" AND ");
  const total = (
    sqlite.prepare(`SELECT COUNT(*) AS c FROM facts WHERE ${whereSql}`).get(...params) as {
      c: number;
    }
  ).c;

  const sel = dims.map((d) => `d${d.slot} AS "${d.code}"`).join(", ");
  const rows = sqlite
    .prepare(
      `SELECT id, ${sel}, value, upload_id AS uploadId, updated_at AS updatedAt
       FROM facts WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, page * pageSize);

  // Kod -> ad haritalari
  const names: Record<string, Record<string, string>> = {};
  for (const d of dims) {
    names[d.code] = Object.fromEntries(d.members.map((m) => [m.code, m.name]));
  }

  return NextResponse.json({
    rows,
    total,
    dims: dims.map((d) => ({ code: d.code, name: d.name })),
    names,
  });
}

// Kesit bazli veri silme (filtreye uyan tum kayitlar)
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { modelId, filters } = parsed.data;
  const hasFilter = Object.values(filters).some((v) => v.length > 0);
  if (!hasFilter) {
    return NextResponse.json(
      { error: "filter_required", message: "Tüm modeli silmek için en az bir filtre seçilmeli" },
      { status: 400 }
    );
  }
  const { where, params, empty } = buildWhere(modelId, filters, session.id);
  if (empty) return NextResponse.json({ deleted: 0 });

  const info = sqlite
    .prepare(`DELETE FROM facts WHERE ${where.join(" AND ")}`)
    .run(...params);
  logAudit(session.id, "facts.delete", "model", modelId, {
    filters,
    deleted: info.changes,
  });
  return NextResponse.json({ deleted: info.changes });
}
