import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { canAccessCommentEntity } from "@/lib/access";
import { createNotifications, resolveMentionedUserIds } from "@/lib/notifications";

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

  notifyCommentRecipients(session.id, session.tenantId, entityType, entityId, text);

  return NextResponse.json({ id }, { status: 201 });
}

// Yorum sahibi (report/dashboard owner_id) ve metinde @mention edilen
// kullanicilara bildirim olusturur (yazan haric). Mention edilen bir
// kullanici ayni zamanda owner ise mention bildirimi tercih edilir
// (daha spesifik). "cell" turunde sahiplik modeli olmadigi icin sadece
// mention bildirimi gonderilir.
function notifyCommentRecipients(
  authorId: number,
  tenantId: number,
  entityType: "report" | "dashboard" | "cell",
  entityId: string,
  text: string
) {
  const mentionedIds = resolveMentionedUserIds(text, tenantId).filter((id) => id !== authorId);
  const link = entityType === "report" ? "/reports" : entityType === "dashboard" ? "/dashboards" : null;

  let entityName = entityId;
  let ownerId: number | null = null;
  if (entityType === "report" || entityType === "dashboard") {
    const table = entityType === "report" ? "reports" : "dashboards";
    const row = sqlite
      .prepare(`SELECT name, owner_id AS ownerId FROM ${table} WHERE id = ?`)
      .get(Number(entityId)) as { name: string; ownerId: number } | undefined;
    if (row) {
      entityName = row.name;
      ownerId = row.ownerId;
    }
  }

  const author = sqlite.prepare("SELECT name FROM users WHERE id = ?").get(authorId) as
    | { name: string }
    | undefined;
  const params = { userName: author?.name ?? "?", entityName };

  if (mentionedIds.length > 0) {
    createNotifications(mentionedIds, "comment_mention", params, link);
  }
  if (ownerId != null && ownerId !== authorId && !mentionedIds.includes(ownerId)) {
    createNotifications([ownerId], "comment_new", params, link);
  }
}
