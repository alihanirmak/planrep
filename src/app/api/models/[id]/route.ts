import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await params).id);

  const model = sqlite
    .prepare("SELECT id, code, name, description, created_at AS createdAt FROM models WHERE id = ?")
    .get(id);
  if (!model) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const dims = sqlite
    .prepare(
      `SELECT d.id, d.code, d.name, d.type, d.visibility, md.slot,
              (SELECT COUNT(*) FROM dimension_members dm WHERE dm.dimension_id = d.id) AS memberCount
       FROM model_dimensions md JOIN dimensions d ON d.id = md.dimension_id
       WHERE md.model_id = ? ORDER BY md.slot`
    )
    .all(id);
  const factCount = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM facts WHERE model_id = ?").get(id) as { c: number }
  ).c;
  const reportCount = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM reports WHERE model_id = ?").get(id) as { c: number }
  ).c;
  const uploads = sqlite
    .prepare(
      `SELECT u.id, u.filename, u.row_count AS rowCount, u.status, u.created_at AS createdAt,
              usr.name AS userName
       FROM uploads u LEFT JOIN users usr ON usr.id = u.user_id
       WHERE u.model_id = ? ORDER BY u.id DESC LIMIT 5`
    )
    .all(id);

  return NextResponse.json({ ...model, dims, factCount, reportCount, uploads });
}

// Model silme: fact, model boyutu, rapor ve ilgili yuklemeler birlikte silinir
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = Number((await params).id);
  const model = sqlite.prepare("SELECT code, name FROM models WHERE id = ?").get(id) as
    | { code: string; name: string }
    | undefined;
  if (!model) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM facts WHERE model_id = ?").run(id);
    sqlite.prepare("DELETE FROM model_dimensions WHERE model_id = ?").run(id);
    sqlite.prepare("DELETE FROM reports WHERE model_id = ?").run(id);
    sqlite.prepare("DELETE FROM uploads WHERE model_id = ?").run(id);
    sqlite.prepare("DELETE FROM models WHERE id = ?").run(id);
  });
  tx();

  logAudit(session.id, "model.delete", "model", id, { code: model.code });
  return NextResponse.json({ ok: true });
}
