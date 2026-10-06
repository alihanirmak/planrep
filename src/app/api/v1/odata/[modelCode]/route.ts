import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { getModelDims } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { buildFactWhereVariants } from "@/lib/fact-filters";
import { requireApiKey } from "@/lib/api-auth";
import { parseODataFilter, buildODataEnvelope, parseTopSkip } from "@/lib/odata";

// Ham fact satirlarini (model kodu ile secilen) BI araclarina JSON olarak
// export eder. Oncelikli olarak Power BI/Tableau'nun REST/Web baglayicisi
// icin tasarlandi (bkz. lib/odata.ts ustundeki kapsam notu — tam OData v4
// degil, pragmatik bir JSON alt kumesi). Erisim kontrolu: cagiran API
// anahtarinin sahibi olan kullanicinin allowedSets kisitlari AYNEN
// uygulanir — bir API anahtari, sahibinin UI'da gorebileceginden fazla
// veriye erisemez.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ modelCode: string }> }
) {
  const result = requireApiKey(req);
  if ("error" in result) return result.error;
  const { auth } = result;

  const { modelCode } = await params;
  const model = sqlite
    .prepare("SELECT id, code, name FROM models WHERE UPPER(code) = UPPER(?) AND tenant_id = ?")
    .get(modelCode, auth.tenantId) as { id: number; code: string; name: string } | undefined;
  if (!model) {
    return NextResponse.json({ error: "not_found", message: `Model bulunamadı: ${modelCode}` }, { status: 404 });
  }

  const dims = getModelDims(model.id);
  const url = new URL(req.url);
  const { top, skip } = parseTopSkip(url.searchParams);

  const filterResult = parseODataFilter(url.searchParams.get("$filter"));
  if (!filterResult.ok) {
    return NextResponse.json({ error: "invalid_filter", message: filterResult.error }, { status: 400 });
  }
  const unknownFields = Object.keys(filterResult.filters).filter(
    (f) => !dims.some((d) => d.code === f)
  );
  if (unknownFields.length > 0) {
    return NextResponse.json(
      { error: "invalid_filter", message: `Bilinmeyen alan(lar): ${unknownFields.join(", ")}` },
      { status: 400 }
    );
  }

  const selectParam = url.searchParams.get("$select");
  const selectedFields = selectParam
    ? selectParam.split(",").map((f) => f.trim()).filter(Boolean)
    : null;
  if (selectedFields) {
    const validFields = new Set([...dims.map((d) => d.code), "value", "updatedAt"]);
    const invalid = selectedFields.filter((f) => !validFields.has(f));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "invalid_select", message: `Bilinmeyen alan(lar): ${invalid.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const access = allowedSets(auth.userId, dims);
  const { variants, empty } = buildFactWhereVariants(model.id, dims, filterResult.filters, access);

  const contextUrl = new URL(req.url);
  contextUrl.search = "";
  contextUrl.pathname = contextUrl.pathname.replace(/\/[^/]+$/, "/metadata");
  const context = `${contextUrl.toString()}#${model.code}`;

  if (empty) {
    return NextResponse.json(buildODataEnvelope(context, [], 0));
  }

  const sel = dims.map((d) => `d${d.slot} AS "${d.code}"`).join(", ");
  let total = 0;
  let rawRows: Array<Record<string, unknown>>;
  if (variants.length === 1) {
    const v = variants[0];
    total = (
      sqlite.prepare(`SELECT COUNT(*) AS c FROM facts WHERE ${v.sql}`).get(...v.params) as { c: number }
    ).c;
    rawRows = sqlite
      .prepare(
        `SELECT ${sel}, value, updated_at AS updatedAt
         FROM facts WHERE ${v.sql} ORDER BY id ASC LIMIT ? OFFSET ?`
      )
      .all(...v.params, top, skip) as Array<Record<string, unknown>>;
  } else {
    // IN(...) listesi chunk'landigi icin birden fazla varyant var — her
    // birini limitsiz calistirip JS tarafinda birlestir/sirala, sayfalamayi
    // burada yap (bkz. api/facts/route.ts'teki ayni desen).
    const all: Array<Record<string, unknown>> = [];
    for (const v of variants) {
      const part = sqlite
        .prepare(`SELECT ${sel}, value, updated_at AS updatedAt FROM facts WHERE ${v.sql}`)
        .all(...v.params) as Array<Record<string, unknown>>;
      all.push(...part);
    }
    total = all.length;
    rawRows = all.slice(skip, skip + top);
  }

  const rows = selectedFields
    ? rawRows.map((r) => Object.fromEntries(selectedFields.map((f) => [f, r[f]])))
    : rawRows;

  return NextResponse.json(buildODataEnvelope(context, rows, total));
}
