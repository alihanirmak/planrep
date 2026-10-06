import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";

type Row = {
  id: number;
  name: string;
  owner_id: number;
  definition: string;
  shared: number;
};

function getDashboard(id: number, tenantId: number): Row | undefined {
  return sqlite.prepare("SELECT * FROM dashboards WHERE id = ? AND tenant_id = ?").get(id, tenantId) as
    | Row
    | undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  const r = getDashboard(id, session.tenantId);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.owner_id !== session.id && r.shared !== 1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    id: r.id,
    name: r.name,
    shared: r.shared === 1,
    definition: JSON.parse(r.definition),
    mine: r.owner_id === session.id,
  });
}

const putSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  definition: z.unknown().optional(),
  shared: z.boolean().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  const r = getDashboard(id, session.tenantId);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.owner_id !== session.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { name, definition, shared } = parsed.data;
  sqlite
    .prepare(
      `UPDATE dashboards SET
         name = COALESCE(?, name),
         definition = COALESCE(?, definition),
         shared = COALESCE(?, shared),
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      name ?? null,
      definition != null ? JSON.stringify(definition) : null,
      shared != null ? (shared ? 1 : 0) : null,
      new Date().toISOString(),
      id
    );
  logAudit(session.id, "dashboard.update", "dashboard", id, { name, shared });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  const r = getDashboard(id, session.tenantId);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.owner_id !== session.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM comments WHERE entity_type = 'dashboard' AND entity_id = ?").run(String(id));
    sqlite.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
  });
  tx();
  logAudit(session.id, "dashboard.delete", "dashboard", id, { name: r.name });
  return NextResponse.json({ ok: true });
}
