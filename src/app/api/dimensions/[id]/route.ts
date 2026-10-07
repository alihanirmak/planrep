import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getServerT } from "@/lib/i18n-server";
import {
  listDimensionAttributesWithMeta,
  getAttributeValuesForMembers,
  getRefMemberOptions,
} from "@/lib/dimension-attributes";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();

  const dim = sqlite
    .prepare(
      `SELECT d.id, d.code, d.name, d.type, d.description, d.visibility,
              d.owner_model_id AS ownerModelId, m.name AS ownerModelName
       FROM dimensions d LEFT JOIN models m ON m.id = d.owner_model_id
       WHERE d.id = ? AND d.tenant_id = ?`
    )
    .get(id, session.tenantId);
  if (!dim) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const members = sqlite
    .prepare(
      `SELECT id, code, name, parent_id AS parentId, order_idx AS orderIdx
       FROM dimension_members WHERE dimension_id = ? ORDER BY order_idx, id`
    )
    .all(id) as Array<{ id: number; code: string; name: string; parentId: number | null; orderIdx: number }>;
  const usedIn = sqlite
    .prepare(
      `SELECT m.id, m.name, m.code, md.slot
       FROM model_dimensions md JOIN models m ON m.id = md.model_id
       WHERE md.dimension_id = ? ORDER BY m.id`
    )
    .all(id);

  const attributes = listDimensionAttributesWithMeta(id);
  const attrValuesByMember = getAttributeValuesForMembers(members.map((m) => m.id));
  const membersWithAttrs = members.map((m) => ({ ...m, attributes: attrValuesByMember.get(m.id) ?? {} }));
  const refOptions = getRefMemberOptions(attributes);

  return NextResponse.json({ ...dim, members: membersWithAttrs, attributes, refOptions, usedIn });
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).nullish(),
  visibility: z.enum(["public", "private"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = parseIdParam((await params).id);

  if (id === null) return invalidIdResponse();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Number.isNaN(id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { name, description, visibility } = parsed.data;
  const info = sqlite
    .prepare(
      `UPDATE dimensions SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         visibility = COALESCE(?, visibility)
       WHERE id = ? AND tenant_id = ?`
    )
    .run(name ?? null, description ?? null, visibility ?? null, id, session.tenantId);
  if (info.changes === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logAudit(session.id, "dimension.update", "dimension", id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = parseIdParam((await params).id);

  if (id === null) return invalidIdResponse();
  const dim = sqlite
    .prepare("SELECT id FROM dimensions WHERE id = ? AND tenant_id = ?")
    .get(id, session.tenantId);
  if (!dim) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const used = sqlite
    .prepare("SELECT COUNT(*) AS c FROM model_dimensions WHERE dimension_id = ?")
    .get(id) as { c: number };
  if (used.c > 0) {
    const { t } = await getServerT();
    return NextResponse.json(
      { error: "in_use", message: t("err.dimensionInUse") },
      { status: 400 }
    );
  }
  // Baska bir boyutun member_ref attribute'u bu boyuta isaret ediyorsa silme
  // engellenir (silinirse o attribute'un dropdown'u/dogrulamasi kirilirdi).
  const refUsed = sqlite
    .prepare("SELECT COUNT(*) AS c FROM dimension_attributes WHERE ref_dimension_id = ?")
    .get(id) as { c: number };
  if (refUsed.c > 0) {
    const { t } = await getServerT();
    return NextResponse.json(
      { error: "ref_in_use", message: t("err.dimensionRefInUse") },
      { status: 400 }
    );
  }
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare(
        `DELETE FROM dimension_member_attribute_values WHERE attribute_id IN
           (SELECT id FROM dimension_attributes WHERE dimension_id = ?)`
      )
      .run(id);
    sqlite.prepare("DELETE FROM dimension_attributes WHERE dimension_id = ?").run(id);
    sqlite.prepare("DELETE FROM dimension_members WHERE dimension_id = ?").run(id);
    sqlite.prepare("DELETE FROM dimensions WHERE id = ?").run(id);
  });
  tx();
  logAudit(session.id, "dimension.delete", "dimension", id);
  return NextResponse.json({ ok: true });
}
