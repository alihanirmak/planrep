import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims } from "@/lib/model";
import { revertUpload } from "@/lib/facts-write";
import { logAudit } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = Number((await params).id);
  const upload = sqlite
    .prepare("SELECT id, status, model_id AS modelId FROM uploads WHERE id = ?")
    .get(id) as { id: number; status: string; modelId: number } | undefined;
  if (!upload) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (upload.status !== "done") {
    return NextResponse.json({ error: "already_reverted" }, { status: 400 });
  }

  const dims = getModelDims(upload.modelId);
  const restored = revertUpload(id, upload.modelId, dims, session.id);

  logAudit(session.id, "upload.revert", "upload", id, { restored });
  return NextResponse.json({ ok: true, restored });
}
