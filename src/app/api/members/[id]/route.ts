import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getServerT } from "@/lib/i18n-server";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  parentCode: z.string().nullish(),
  orderIdx: z.number().int().optional(),
});

// Yeni parent, memberId'nin mevcut torunlarindan biri (veya kendisi) mi?
// Oyleyse atama hiyerarsik dongu olusturur. Ebeveyn zincirini yukari dogru
// yururuz; memberId'ye rastlarsak dongu vardir.
function isDescendant(
  dimensionId: number,
  memberId: number,
  candidateParentId: number
): boolean {
  let current: number | null = candidateParentId;
  const visited = new Set<number>();
  while (current !== null) {
    if (current === memberId) return true;
    if (visited.has(current)) return true; // zaten var olan bozuk bir dongu, guvenlik icin durdur
    visited.add(current);
    const parent = sqlite
      .prepare("SELECT parent_id AS parentId FROM dimension_members WHERE id = ? AND dimension_id = ?")
      .get(current, dimensionId) as { parentId: number | null } | undefined;
    current = parent?.parentId ?? null;
  }
  return false;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const row = sqlite
    .prepare(
      `SELECT dm.id, dm.dimension_id AS dimensionId FROM dimension_members dm
       JOIN dimensions d ON d.id = dm.dimension_id
       WHERE dm.id = ? AND d.tenant_id = ?`
    )
    .get(id, session.tenantId) as { id: number; dimensionId: number } | undefined;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { name, parentCode, orderIdx } = parsed.data;

  let parentId: number | null | undefined = undefined;
  if (parentCode !== undefined) {
    if (parentCode === null || parentCode === "") parentId = null;
    else {
      const parent = sqlite
        .prepare("SELECT id FROM dimension_members WHERE dimension_id = ? AND code = ?")
        .get(row.dimensionId, parentCode) as { id: number } | undefined;
      if (!parent) return NextResponse.json({ error: "parent_not_found" }, { status: 400 });
      if (parent.id === id) return NextResponse.json({ error: "self_parent" }, { status: 400 });
      if (isDescendant(row.dimensionId, id, parent.id)) {
        return NextResponse.json({ error: "cyclic_parent" }, { status: 400 });
      }
      parentId = parent.id;
    }
  }

  sqlite
    .prepare(
      `UPDATE dimension_members SET
         name = COALESCE(?, name),
         parent_id = CASE WHEN ? THEN ? ELSE parent_id END,
         order_idx = COALESCE(?, order_idx)
       WHERE id = ?`
    )
    .run(name ?? null, parentId !== undefined ? 1 : 0, parentId ?? null, orderIdx ?? null, id);
  logAudit(session.id, "member.update", "member", id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const row = sqlite
    .prepare(
      `SELECT dm.id FROM dimension_members dm
       JOIN dimensions d ON d.id = dm.dimension_id
       WHERE dm.id = ? AND d.tenant_id = ?`
    )
    .get(id, session.tenantId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const children = sqlite
    .prepare("SELECT COUNT(*) AS c FROM dimension_members WHERE parent_id = ?")
    .get(id) as { c: number };
  if (children.c > 0) {
    const { t } = await getServerT();
    return NextResponse.json(
      { error: "has_children", message: t("err.memberHasChildren") },
      { status: 400 }
    );
  }
  const info = sqlite.prepare("DELETE FROM dimension_members WHERE id = ?").run(id);
  if (info.changes === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logAudit(session.id, "member.delete", "member", id);
  return NextResponse.json({ ok: true });
}
