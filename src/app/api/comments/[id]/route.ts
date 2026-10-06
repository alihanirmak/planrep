import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { canAccessCommentEntity } from "@/lib/access";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();
  const row = sqlite
    .prepare("SELECT user_id, entity_type AS entityType, entity_id AS entityId FROM comments WHERE id = ?")
    .get(id) as { user_id: number; entityType: "report" | "dashboard" | "cell"; entityId: string } | undefined;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Tenant kontrolu: comments tablosunun kendi tenant_id'si yok (transitive
  // izolasyon) — ebeveyn entity (report/dashboard) uzerinden dogrulanir.
  // Yazarin kendisi her zaman kendi yorumunu silebilir (ayni tenant icinde
  // olmasi garanti, cunku yorum olusturulurken zaten erisim kontrolu gecti).
  if (row.user_id !== session.id) {
    const hasEntityAccess = canAccessCommentEntity(session, row.entityType, row.entityId);
    if (!hasEntityAccess || session.role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  sqlite.prepare("DELETE FROM comments WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
