import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { buildFactWhereVariants } from "@/lib/fact-filters";
import { upsertFacts, type FactWrite } from "@/lib/facts-write";
import { WorkflowLockError } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  modelId: z.number().int(),
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  filters: z.record(z.string(), z.array(z.string())).default({}),
});

// VERSION tipi bir boyuttaki bir uyenin (orn. BUDGET) tum verisini, ayni
// koordinatlarda baska bir uyeye (orn. FORECAST) kopyalar. Ortaya cikan
// yazim normal bir "upload" gibi uploads tablosuna kaydedilir, boylece
// mevcut /api/uploads/[id]/revert ucuyla geri alinabilir. Hedef kapsamda
// aktif bir workflow kilidi varsa islem reddedilir (upsertFacts icinde kontrol).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { modelId, fromVersion, toVersion, filters } = parsed.data;
  if (fromVersion === toVersion) {
    return NextResponse.json({ error: "same_version" }, { status: 400 });
  }

  const dims = getModelDims(modelId);
  if (dims.length === 0) return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  const versionDim = dims.find((d) => d.type === "version");
  if (!versionDim) return NextResponse.json({ error: "no_version_dimension" }, { status: 400 });

  const validCodes = new Set(versionDim.members.map((m) => m.code));
  if (!validCodes.has(fromVersion) || !validCodes.has(toVersion)) {
    return NextResponse.json({ error: "invalid_version" }, { status: 400 });
  }

  const access = allowedSets(session.id, dims);
  const sourceFilters = { ...filters, [versionDim.code]: [fromVersion] };
  const { variants, empty } = buildFactWhereVariants(modelId, dims, sourceFilters, access);
  if (empty) return NextResponse.json({ ok: true, copied: 0 });

  const sel = dims.map((d) => `d${d.slot} AS d${d.slot}`).join(", ");
  const sourceRows: Array<Record<string, unknown>> = [];
  for (const v of variants) {
    const part = sqlite
      .prepare(`SELECT ${sel}, value FROM facts WHERE ${v.sql}`)
      .all(...v.params) as Array<Record<string, unknown>>;
    sourceRows.push(...part);
  }
  if (sourceRows.length === 0) return NextResponse.json({ ok: true, copied: 0 });

  // Hedef erisim kontrolu: toVersion icin yazma yetkisi var mi?
  const versionAccess = access.get(versionDim.code);
  if (versionAccess && !versionAccess.has(toVersion)) {
    return NextResponse.json({ error: "forbidden_target_version" }, { status: 403 });
  }

  const rows: FactWrite[] = sourceRows.map((r) => ({
    coords: dims.map((d) =>
      d.code === versionDim.code ? toVersion : String(r[`d${d.slot}`])
    ),
    value: Number(r.value),
  }));

  const now = new Date().toISOString();
  const uploadId = Number(
    sqlite
      .prepare(
        "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
      )
      .run(modelId, `Senaryo kopyası: ${fromVersion} → ${toVersion}`, session.id, rows.length, now)
      .lastInsertRowid
  );

  try {
    upsertFacts(modelId, dims, rows, uploadId, now);
  } catch (e) {
    if (e instanceof WorkflowLockError) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      return NextResponse.json({ error: "workflow_locked", message: e.message }, { status: 423 });
    }
    throw e;
  }

  logAudit(session.id, "scenario.copy", "upload", uploadId, {
    modelId,
    fromVersion,
    toVersion,
    filters,
    rows: rows.length,
  });
  return NextResponse.json({ ok: true, uploadId, copied: rows.length });
}
