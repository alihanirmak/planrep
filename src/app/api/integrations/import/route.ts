import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getConnectorInstance } from "@/lib/connectors";
import { getModelDims } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { upsertFacts } from "@/lib/facts-write";
import { WorkflowLockError } from "@/lib/workflow";
import { BusinessRuleError } from "@/lib/business-rules";
import { logAudit } from "@/lib/audit";
import { parseLocaleNumber } from "@/lib/number";
import { getServerT } from "@/lib/i18n-server";

const MAX_ERRORS = 50;

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

  const connectorInstance = getConnectorInstance(connectorId);
  if (!connectorInstance) return NextResponse.json({ error: "connector_not_found" }, { status: 404 });
  const connector = connectorInstance.connector;
  const dims = getModelDims(modelId);
  if (dims.length === 0) return NextResponse.json({ error: "model_not_found" }, { status: 404 });

  // Esleme kontrolu: her boyut + DEGER tam bir kez eslenmis olmali
  const errors: string[] = [];
  const dimToColumn = new Map<string, string>();
  let valueColumn: string | null = null;
  for (const [column, target] of Object.entries(mapping)) {
    if (!target) continue;
    if (target === "DEGER") {
      if (valueColumn) errors.push("Birden fazla kolon DEGER olarak eşlendi");
      valueColumn = column;
    } else {
      if (dimToColumn.has(target)) errors.push(`${target} boyutu birden fazla kolona eşlendi`);
      dimToColumn.set(target, column);
    }
  }
  for (const d of dims) {
    if (!dimToColumn.has(d.code)) errors.push(`Eksik boyut eşlemesi: ${d.code} (${d.name})`);
  }
  if (!valueColumn) errors.push("DEGER eşlemesi yapılmadı");
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation", errors }, { status: 400 });
  }

  let data;
  try {
    data = await connector.fetchRows(source);
  } catch (e) {
    const { t } = await getServerT();
    return NextResponse.json(
      { error: "fetch_failed", message: e instanceof Error ? e.message : t("err.generic") },
      { status: 502 }
    );
  }

  const memberLookup = dims.map((d) => {
    const map = new Map<string, string>();
    for (const m of d.members) {
      map.set(m.code.toLocaleLowerCase("tr"), m.code);
      map.set(m.name.toLocaleLowerCase("tr"), m.code);
    }
    return map;
  });
  const access = allowedSets(session.id, dims);

  type FactRow = { coords: string[]; value: number };
  const rows: FactRow[] = [];
  data.rows.forEach((row: Record<string, string | number>, idx: number) => {
    const coords: string[] = new Array(dims.length).fill("");
    let bad = false;
    dims.forEach((d, di) => {
      const raw = String(row[dimToColumn.get(d.code)!] ?? "").trim();
      const code = memberLookup[di].get(raw.toLocaleLowerCase("tr"));
      if (!code) {
        if (errors.length < MAX_ERRORS)
          errors.push(`Satır ${idx + 1}: "${raw}" ${d.name} boyutunda bulunamadı`);
        bad = true;
        return;
      }
      const allowed = access.get(d.code);
      if (allowed && !allowed.has(code)) {
        if (errors.length < MAX_ERRORS)
          errors.push(`Satır ${idx + 1}: "${raw}" (${d.name}) için yazma yetkiniz yok`);
        bad = true;
        return;
      }
      coords[di] = code;
    });
    const rawVal = row[valueColumn!];
    const num = parseLocaleNumber(rawVal);
    if (Number.isNaN(num)) {
      if (errors.length < MAX_ERRORS) errors.push(`Satır ${idx + 1}: geçersiz sayı`);
      bad = true;
    }
    if (!bad) rows.push({ coords, value: num });
  });

  if (errors.length > 0) {
    return NextResponse.json(
      { error: "validation", errors, validRows: rows.length },
      { status: 400 }
    );
  }
  if (rows.length === 0) return NextResponse.json({ error: "empty_source" }, { status: 400 });

  const now = new Date().toISOString();
  const uploadId = Number(
    sqlite
      .prepare(
        "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
      )
      .run(modelId, `SAP: ${source}`, session.id, rows.length, now).lastInsertRowid
  );

  let result;
  try {
    result = upsertFacts(modelId, dims, rows, uploadId, now, session.id);
  } catch (e) {
    if (e instanceof WorkflowLockError) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      return NextResponse.json({ error: "workflow_locked", message: e.message }, { status: 423 });
    }
    if (e instanceof BusinessRuleError) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      return NextResponse.json({ error: "business_rule_violated", message: e.message }, { status: 400 });
    }
    throw e;
  }

  logAudit(session.id, "import.sap", "upload", uploadId, {
    connector: connectorId,
    source,
    modelId,
    rows: rows.length,
  });
  return NextResponse.json({
    ok: true,
    uploadId,
    inserted: rows.length,
    warnings: result.warnings.map((w) => w.rule.message || `"${w.rule.name}" kuralı ihlal edildi`),
  });
}
