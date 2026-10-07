import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { listDimensionAttributes, setMemberAttributeValue, validateAttributeValue } from "@/lib/dimension-attributes";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  values: z.record(z.string(), z.string().nullable()),
});

// Bir uyenin birden fazla attribute degerini tek istekte gunceller (UI
// hucre-bazli duzenleme icin genelde tek anahtarli bir obje gonderir, ama
// toplu guncelleme de desteklenir). Once TUM degerler dogrulanir, sonra
// hicbiri gecersizse topluca yazilir — kismi yazma (bazisi gecerli bazisi
// degil) ONLENIR.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();

  const member = sqlite
    .prepare(
      `SELECT dm.id, dm.dimension_id AS dimensionId FROM dimension_members dm
       JOIN dimensions d ON d.id = dm.dimension_id
       WHERE dm.id = ? AND d.tenant_id = ?`
    )
    .get(id, session.tenantId) as { id: number; dimensionId: number } | undefined;
  if (!member) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const attrs = listDimensionAttributes(member.dimensionId);
  const byCode = new Map(attrs.map((a) => [a.code, a]));

  for (const [code, value] of Object.entries(parsed.data.values)) {
    const attr = byCode.get(code);
    if (!attr) return NextResponse.json({ error: "attribute_not_found", code }, { status: 400 });
    if (value !== null) {
      const err = validateAttributeValue(attr, value);
      if (err) return NextResponse.json({ error: err, code }, { status: 400 });
    }
  }
  for (const [code, value] of Object.entries(parsed.data.values)) {
    setMemberAttributeValue(id, byCode.get(code)!.id, value);
  }

  logAudit(session.id, "member.attributes.update", "member", id, parsed.data.values);
  return NextResponse.json({ ok: true });
}
