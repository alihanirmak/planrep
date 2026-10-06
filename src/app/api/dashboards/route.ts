import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = sqlite
    .prepare(
      `SELECT d.id, d.name, d.owner_id AS ownerId, u.name AS ownerName, d.shared,
              d.updated_at AS updatedAt
       FROM dashboards d LEFT JOIN users u ON u.id = d.owner_id
       WHERE d.tenant_id = ? AND (d.owner_id = ? OR d.shared = 1)
       ORDER BY d.updated_at DESC`
    )
    .all(session.tenantId, session.id) as Array<{ ownerId: number }>;
  return NextResponse.json(rows.map((r) => ({ ...r, mine: r.ownerId === session.id })));
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  definition: z.unknown(),
  shared: z.boolean().default(false),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { name, definition, shared } = parsed.data;
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO dashboards (tenant_id, name, owner_id, definition, shared, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
      )
      .run(session.tenantId, name, session.id, JSON.stringify(definition), shared ? 1 : 0, now, now)
      .lastInsertRowid
  );
  logAudit(session.id, "dashboard.create", "dashboard", id, { name, shared });
  return NextResponse.json({ id }, { status: 201 });
}
