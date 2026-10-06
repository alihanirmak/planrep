import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { versionedUpdate } from "@/lib/version-guard";

type ReportRow = {
  id: number;
  name: string;
  owner_id: number;
  model_id: number;
  definition: string;
  shared: number;
  version: number;
};

function getReport(id: number, tenantId: number): ReportRow | undefined {
  return sqlite.prepare("SELECT * FROM reports WHERE id = ? AND tenant_id = ?").get(id, tenantId) as
    | ReportRow
    | undefined;
}

function toClientShape(r: ReportRow) {
  return {
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    modelId: r.model_id,
    shared: r.shared === 1,
    definition: JSON.parse(r.definition),
    version: r.version,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const r = getReport(id, session.tenantId);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.owner_id !== session.id && r.shared !== 1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ ...toClientShape(r), mine: r.owner_id === session.id });
}

const putSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  definition: z.unknown().optional(),
  shared: z.boolean().optional(),
  // Optimistic concurrency: istemci son GET'te aldigi version'u geri
  // gonderir. Tanimli degilse (eski/uyumsuz istemci) kontrol atlanir —
  // geriye donuk uyumluluk icin, ama bu durumda lost-update riski
  // (eski davranis) geri doner.
  expectedVersion: z.number().int().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const r = getReport(id, session.tenantId);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.owner_id !== session.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { name, definition, shared, expectedVersion } = parsed.data;

  // Optimistic concurrency: bkz. lib/version-guard.ts. Baska bir yazma,
  // bu istemcinin GET yaptigi andan sonra araya girmis olabilir (ayni
  // raporu iki sekmede/kullanicida acik birakma senaryosu) — bu durumda
  // 409 Conflict donulur, istemci kendi degisikligini sessizce ustune
  // yazmaz (bkz. reports/page.tsx conflict banner).
  const result = versionedUpdate(
    "reports",
    id,
    r.version,
    expectedVersion,
    "name = COALESCE(?, name), definition = COALESCE(?, definition), shared = COALESCE(?, shared), updated_at = ?",
    [
      name ?? null,
      definition != null ? JSON.stringify(definition) : null,
      shared != null ? (shared ? 1 : 0) : null,
      new Date().toISOString(),
    ]
  );
  if (!result.ok) {
    const latest = getReport(id, session.tenantId)!;
    return NextResponse.json({ error: "conflict", current: toClientShape(latest) }, { status: 409 });
  }

  logAudit(session.id, "report.update", "report", id, { name, shared });
  return NextResponse.json({ ok: true, version: result.newVersion });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const r = getReport(id, session.tenantId);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.owner_id !== session.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM comments WHERE entity_type = 'report' AND entity_id = ?").run(String(id));
    sqlite.prepare("DELETE FROM reports WHERE id = ?").run(id);
  });
  tx();
  logAudit(session.id, "report.delete", "report", id, { name: r.name });
  return NextResponse.json({ ok: true });
}
