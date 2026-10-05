import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const param = url.searchParams.get("modelId");
  const modelId = param ? Number(param) : NaN;
  const rows = sqlite
    .prepare(
      `SELECT u.id, u.filename, u.row_count AS rowCount, u.status, u.created_at AS createdAt,
              usr.name AS userName, m.name AS modelName
       FROM uploads u
       LEFT JOIN users usr ON usr.id = u.user_id
       LEFT JOIN models m ON m.id = u.model_id
       ${Number.isNaN(modelId) ? "" : "WHERE u.model_id = ?"}
       ORDER BY u.id DESC LIMIT 100`
    )
    .all(...(Number.isNaN(modelId) ? [] : [modelId]));
  return NextResponse.json(rows);
}
