import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getModelDims } from "@/lib/model";
import { runConnectorImport } from "@/lib/integrations/run-import";
import { getServerT } from "@/lib/i18n-server";

const schema = z.object({
  connector: z.number().int(),
  source: z.string(),
  modelId: z.number().int(),
  // kaynak kolonu -> boyut kodu veya "DEGER" ("" = yoksay)
  mapping: z.record(z.string(), z.string()),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { connector: connectorId, source, modelId, mapping } = parsed.data;

  // Model yoksa dims.length === 0 olur ama bu durumu runConnectorImport'tan
  // once (connector var mi kontrolunden sonra) ayirt edebilmek icin burada
  // ayrica kontrol etmiyoruz — runConnectorImport zaten "model_not_found" donuyor.
  if (getModelDims(modelId).length === 0) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }

  const { t } = await getServerT();
  const result = await runConnectorImport({
    connectorConfigId: connectorId,
    source,
    modelId,
    mapping,
    userId: session.id,
    genericErrorMessage: t("err.generic"),
  });

  if (!result.ok) {
    switch (result.error) {
      case "connector_not_found":
        return NextResponse.json({ error: result.error }, { status: 404 });
      case "model_not_found":
        return NextResponse.json({ error: result.error }, { status: 404 });
      case "validation":
        return NextResponse.json(
          { error: "validation", errors: result.errors, validRows: result.validRows },
          { status: 400 }
        );
      case "fetch_failed":
        return NextResponse.json({ error: "fetch_failed", message: result.message }, { status: 502 });
      case "empty_source":
        return NextResponse.json({ error: "empty_source" }, { status: 400 });
      case "workflow_locked":
        return NextResponse.json({ error: "workflow_locked", message: result.message }, { status: 423 });
      case "business_rule_violated":
        return NextResponse.json({ error: "business_rule_violated", message: result.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, uploadId: result.uploadId, inserted: result.inserted, warnings: result.warnings });
}
