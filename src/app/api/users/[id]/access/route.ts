import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getUserAccess, setUserAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number((await params).id);
  return NextResponse.json(getUserAccess(id));
}

const putSchema = z.object({
  entries: z.array(
    z.object({
      dimensionId: z.number().int(),
      memberCodes: z.array(z.string()),
    })
  ),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number((await params).id);
  const user = sqlite.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  setUserAccess(id, parsed.data.entries);
  logAudit(session.id, "user.access", "user", id, parsed.data.entries);
  return NextResponse.json({ ok: true });
}
