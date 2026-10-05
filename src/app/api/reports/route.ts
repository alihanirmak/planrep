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
      `SELECT r.id, r.name, r.owner_id AS ownerId, u.name AS ownerName, r.model_id AS modelId,
              r.shared, r.updated_at AS updatedAt
       FROM reports r LEFT JOIN users u ON u.id = r.owner_id
       WHERE r.owner_id = ? OR r.shared = 1
       ORDER BY r.updated_at DESC`
    )
    .all(session.id) as Array<{ ownerId: number }>;
  return NextResponse.json(
    rows.map((r) => ({ ...r, mine: r.ownerId === session.id }))
  );
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
  const def = definition as { modelId?: number };
  if (typeof def?.modelId !== "number") {
    return NextResponse.json({ error: "invalid_definition" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO reports (name, owner_id, model_id, definition, shared, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
      )
      .run(name, session.id, def.modelId, JSON.stringify(definition), shared ? 1 : 0, now, now)
      .lastInsertRowid
  );
  logAudit(session.id, "report.create", "report", id, { name, shared });
  return NextResponse.json({ id }, { status: 201 });
}
