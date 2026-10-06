import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getScheduledSync, updateScheduledSync, deleteScheduledSync } from "@/lib/scheduled-sync";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  source: z.string().min(1).optional(),
  mapping: z.record(z.string(), z.string()).optional(),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const existing = getScheduledSync(id);
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const updated = updateScheduledSync(id, parsed.data);
  logAudit(session.id, "scheduled_sync.update", "scheduled_sync", id, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const existing = getScheduledSync(id);
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  deleteScheduledSync(id);
  logAudit(session.id, "scheduled_sync.delete", "scheduled_sync", id);
  return NextResponse.json({ ok: true });
}
