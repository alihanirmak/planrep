import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  code: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  parentCode: z.string().nullish(),
  orderIdx: z.number().int().default(0),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const dimensionId = Number((await params).id);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Number.isNaN(dimensionId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { code, name, parentCode, orderIdx } = parsed.data;

  const dim = sqlite.prepare("SELECT id FROM dimensions WHERE id = ?").get(dimensionId);
  if (!dim) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const exists = sqlite
    .prepare("SELECT id FROM dimension_members WHERE dimension_id = ? AND code = ?")
    .get(dimensionId, code);
  if (exists) return NextResponse.json({ error: "code_exists" }, { status: 409 });

  let parentId: number | null = null;
  if (parentCode) {
    const parent = sqlite
      .prepare("SELECT id FROM dimension_members WHERE dimension_id = ? AND code = ?")
      .get(dimensionId, parentCode) as { id: number } | undefined;
    if (!parent) return NextResponse.json({ error: "parent_not_found" }, { status: 400 });
    parentId = parent.id;
  }

  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
      )
      .run(dimensionId, code, name, parentId, orderIdx).lastInsertRowid
  );
  logAudit(session.id, "member.create", "dimension", dimensionId, { code, name, parentCode });
  return NextResponse.json({ id }, { status: 201 });
}
