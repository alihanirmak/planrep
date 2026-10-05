import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dims = sqlite
    .prepare(
      `SELECT d.id, d.code, d.name, d.type, d.description, d.visibility,
              d.owner_model_id AS ownerModelId, m.name AS ownerModelName
       FROM dimensions d LEFT JOIN models m ON m.id = d.owner_model_id
       ORDER BY d.id`
    )
    .all() as Array<{ id: number }>;
  const memStmt = sqlite.prepare(
    `SELECT id, code, name, parent_id AS parentId, order_idx AS orderIdx
     FROM dimension_members WHERE dimension_id = ? ORDER BY order_idx, id`
  );
  const usedStmt = sqlite.prepare(
    `SELECT m.id, m.name FROM model_dimensions md JOIN models m ON m.id = md.model_id
     WHERE md.dimension_id = ? ORDER BY m.id`
  );
  return NextResponse.json(
    dims.map((d) => ({ ...d, members: memStmt.all(d.id), usedIn: usedStmt.all(d.id) }))
  );
}

const createSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Za-z0-9_]+$/, "Kod sadece harf/rakam/alt çizgi"),
  name: z.string().min(1).max(80),
  type: z.enum(["standard", "time", "version"]).default("standard"),
  description: z.string().max(300).nullish(),
  visibility: z.enum(["public", "private"]).default("public"),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { code, name, type, description, visibility } = parsed.data;
  const upper = code.toUpperCase();
  const exists = sqlite.prepare("SELECT id FROM dimensions WHERE code = ?").get(upper);
  if (exists) return NextResponse.json({ error: "code_exists" }, { status: 409 });

  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO dimensions (code, name, type, description, visibility) VALUES (?,?,?,?,?)"
      )
      .run(upper, name, type, description ?? null, visibility).lastInsertRowid
  );
  logAudit(session.id, "dimension.create", "dimension", id, { code: upper, name, visibility });
  return NextResponse.json({ id }, { status: 201 });
}
