import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { buildFactWhereVariants, type WhereVariant } from "@/lib/fact-filters";
import { findBlockingLockForFilters } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { getServerT } from "@/lib/i18n-server";

const bodySchema = z.object({
  modelId: z.number().int(),
  filters: z.record(z.string(), z.array(z.string())).default({}),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(500).default(50),
});

function buildWhere(modelId: number, filters: Record<string, string[]>, userId: number) {
  const dims = getModelDims(modelId);
  const access = allowedSets(userId, dims);
  const { variants, empty } = buildFactWhereVariants(modelId, dims, filters, access);
  return { dims, variants, empty };
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
  const { dims, variants, empty } = buildWhere(modelId, filters, session.id);
  if (dims.length === 0) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }
  if (empty) {
    return NextResponse.json({ rows: [], total: 0, dims: dims.map((d) => d.code) });
  }

  const sel = dims.map((d) => `d${d.slot} AS "${d.code}"`).join(", ");
  let total = 0;
  let rows: unknown[];
  if (variants.length === 1) {
    // Hizli yol: tek varyant, SQL seviyesinde LIMIT/OFFSET kullanilabilir.
    const v = variants[0];
    total = (
      sqlite.prepare(`SELECT COUNT(*) AS c FROM facts WHERE ${v.sql}`).get(...v.params) as {
        c: number;
      }
    ).c;
    rows = sqlite
      .prepare(
        `SELECT id, ${sel}, value, upload_id AS uploadId, updated_at AS updatedAt
         FROM facts WHERE ${v.sql} ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(...v.params, pageSize, page * pageSize);
  } else {
    // IN(...) listesi chunk'landigi icin birden fazla varyant var: her varyanti
    // limitsiz calistirip JS tarafinda birlestir/sirala, sayfalamayi burada yap.
    const all: Array<{ id: number }> = [];
    for (const v of variants) {
      const part = sqlite
        .prepare(`SELECT id, ${sel}, value, upload_id AS uploadId, updated_at AS updatedAt FROM facts WHERE ${v.sql}`)
        .all(...v.params) as Array<{ id: number }>;
      all.push(...part);
    }
    all.sort((a, b) => b.id - a.id);
    total = all.length;
    rows = all.slice(page * pageSize, page * pageSize + pageSize);
  }

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
    const { t } = await getServerT();
    return NextResponse.json(
      { error: "filter_required", message: t("err.filterRequiredForFullDelete") },
      { status: 400 }
    );
  }
  const { dims, variants, empty } = buildWhere(modelId, filters, session.id);
  if (empty) return NextResponse.json({ deleted: 0 });

  const blocker = findBlockingLockForFilters(modelId, dims, filters);
  if (blocker) {
    return NextResponse.json(
      {
        error: "workflow_locked",
        message: `Veri kilitli: "${blocker.name}" onay akışı bu veri kesitini kilitlemiş durumda.`,
      },
      { status: 423 }
    );
  }

  let deleted = 0;
  for (const v of variants as WhereVariant[]) {
    const info = sqlite.prepare(`DELETE FROM facts WHERE ${v.sql}`).run(...v.params);
    deleted += info.changes;
  }
  logAudit(session.id, "facts.delete", "model", modelId, {
    filters,
    deleted,
  });
  return NextResponse.json({ deleted });
}
