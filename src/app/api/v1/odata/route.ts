import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { sqlite } from "@/lib/db";

// OData servis belgesi (service document) karsiligi — IdP'lerin kok
// endpoint'inde oldugu gibi, bu tenant'in erisebilecegi "entity set"lerin
// (burada: modeller) listesini doner. Gercek OData'da bu XML/Atom da
// olabilir; biz sadece JSON formatini destekliyoruz (bkz. lib/odata.ts
// ustundeki kapsam notu).
export async function GET(req: Request) {
  const result = requireApiKey(req);
  if ("error" in result) return result.error;
  const { auth } = result;

  const models = sqlite
    .prepare("SELECT code, name FROM models WHERE tenant_id = ? ORDER BY id")
    .all(auth.tenantId) as Array<{ code: string; name: string }>;

  const base = new URL(req.url);
  base.pathname = base.pathname.replace(/\/$/, "");

  return NextResponse.json({
    "@odata.context": `${base.origin}${base.pathname}/metadata`,
    value: models.map((m) => ({
      name: m.code,
      kind: "EntitySet",
      url: m.code,
      title: m.name,
    })),
  });
}
