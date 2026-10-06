import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getModels } from "@/lib/model";

// Basitlestirilmis metadata ucu: gercek OData $metadata XML/EDMX DEGIL
// (bkz. lib/odata.ts ustundeki kapsam notu) — her model icin boyut
// (dimension) kodu/adi/tipini JSON olarak doner, boylece BI araci veya
// entegrasyonu gelistiren kisi hangi $select/$filter alanlarinin
// kullanilabilir oldugunu kesfedebilir.
export async function GET(req: Request) {
  const result = requireApiKey(req);
  if ("error" in result) return result.error;
  const { auth } = result;

  const models = getModels(auth.tenantId);
  return NextResponse.json({
    entities: models.map((m) => ({
      name: m.code,
      title: m.name,
      fields: [
        ...m.dims.map((d) => ({ name: d.code, title: d.name, type: "string" })),
        { name: "value", title: "Değer", type: "number" },
        { name: "updatedAt", title: "Güncellenme Tarihi", type: "datetime" },
      ],
    })),
  });
}
