import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { canAccessCommentEntity } from "@/lib/access";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (
    !entityType ||
    !entityId ||
    !["report", "dashboard", "cell"].includes(entityType)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (
    !canAccessCommentEntity(
      session,
      entityType as "report" | "dashboard" | "cell",
      entityId
    )
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = sqlite
    .prepare(
      `SELECT c.id, c.cell_key AS cellKey, c.text, c.created_at AS createdAt,
              c.user_id AS userId, u.name AS userName
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.entity_type = ? AND c.entity_id = ?
       ORDER BY c.id DESC LIMIT 200`
    )
    .all(entityType, entityId);
  return NextResponse.json(rows);
}

const postSchema = z.object({
  entityType: z.enum(["report", "dashboard", "cell"]),
  entityId: z.string().min(1),
  cellKey: z.string().nullish(),
  text: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { entityType, entityId, cellKey, text } = parsed.data;
  if (!canAccessCommentEntity(session, entityType, entityId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO comments (entity_type, entity_id, cell_key, user_id, text, created_at) VALUES (?,?,?,?,?,?)"
      )
      .run(entityType, entityId, cellKey ?? null, session.id, text, new Date().toISOString())
      .lastInsertRowid
  );
  return NextResponse.json({ id }, { status: 201 });
}
