// api/integrations/import ve lib/scheduled-sync.ts (zamanlanmis sync) tarafindan
// paylasilan cekirdek import mantigi. Boylece manuel import ile zamanlanmis
// senkronizasyon ayni kod yolunu kullanir — davranis asla birbirinden sapmaz.
import { sqlite } from "../db";
import { getConnectorInstance } from "../connectors";
import { getModelDims, getModelTenantId, type DimInfo } from "../model";
import { allowedSets } from "../access";
import { upsertFacts } from "../facts-write";
import { WorkflowLockError } from "../workflow";
import { BusinessRuleError } from "../business-rules";
import { logAudit } from "../audit";
import { parseLocaleNumber } from "../number";

const MAX_ERRORS = 50;

export type RunImportResult =
  | { ok: true; uploadId: number; inserted: number; warnings: string[] }
  | { ok: false; error: "connector_not_found" }
  | { ok: false; error: "model_not_found" }
  | { ok: false; error: "validation"; errors: string[]; validRows?: number }
  | { ok: false; error: "fetch_failed"; message: string }
  | { ok: false; error: "empty_source" }
  | { ok: false; error: "workflow_locked"; message: string }
  | { ok: false; error: "business_rule_violated"; message: string };

export async function runConnectorImport(input: {
  tenantId: number;
  connectorConfigId: number;
  source: string;
  modelId: number;
  mapping: Record<string, string>;
  userId: number;
  uploadLabel?: string;
  genericErrorMessage?: string;
}): Promise<RunImportResult> {
  const { tenantId, connectorConfigId, source, modelId, mapping, userId } = input;
  const genericError = input.genericErrorMessage ?? "hata";

  if (getModelTenantId(modelId) !== tenantId) return { ok: false, error: "model_not_found" };
  const connectorInstance = getConnectorInstance(connectorConfigId, tenantId);
  if (!connectorInstance) return { ok: false, error: "connector_not_found" };
  const connector = connectorInstance.connector;
  const dims: DimInfo[] = getModelDims(modelId);
  if (dims.length === 0) return { ok: false, error: "model_not_found" };

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
    return { ok: false, error: "validation", errors };
  }

  let data;
  try {
    data = await connector.fetchRows(source);
  } catch (e) {
    return { ok: false, error: "fetch_failed", message: e instanceof Error ? e.message : genericError };
  }

  const memberLookup = dims.map((d) => {
    const map = new Map<string, string>();
    for (const m of d.members) {
      map.set(m.code.toLocaleLowerCase("tr"), m.code);
      map.set(m.name.toLocaleLowerCase("tr"), m.code);
    }
    return map;
  });
  const access = allowedSets(userId, dims);

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
    return { ok: false, error: "validation", errors, validRows: rows.length };
  }
  if (rows.length === 0) return { ok: false, error: "empty_source" };

  const now = new Date().toISOString();
  const uploadId = Number(
    sqlite
      .prepare(
        "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
      )
      .run(modelId, input.uploadLabel ?? `SAP: ${source}`, userId, rows.length, now).lastInsertRowid
  );

  let result;
  try {
    result = upsertFacts(modelId, dims, rows, uploadId, now, userId);
  } catch (e) {
    if (e instanceof WorkflowLockError) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      return { ok: false, error: "workflow_locked", message: e.message };
    }
    if (e instanceof BusinessRuleError) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      return { ok: false, error: "business_rule_violated", message: e.message };
    }
    throw e;
  }

  logAudit(userId, "import.sap", "upload", uploadId, {
    connector: connectorConfigId,
    source,
    modelId,
    rows: rows.length,
  });

  return {
    ok: true,
    uploadId,
    inserted: rows.length,
    warnings: result.warnings.map((w) => w.rule.message || `"${w.rule.name}" kuralı ihlal edildi`),
  };
}
