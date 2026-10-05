import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  const row = sqlite.prepare("SELECT user_id FROM comments WHERE id = ?").get(id) as
    | { user_id: number }
    | undefined;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.user_id !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  sqlite.prepare("DELETE FROM comments WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
