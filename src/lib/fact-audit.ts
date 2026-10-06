import { sqlite } from "./db";
import { getModelDims, type DimInfo } from "./model";
import { upsertFacts, logFactAuditBulk, type FactWrite, type FactAuditSource } from "./facts-write";

export type FactAuditEntry = {
  id: number;
  modelId: number;
  uploadId: number | null;
  coords: string[];
  oldValue: number | null;
  newValue: number | null;
  source: FactAuditSource;
  userId: number | null;
  createdAt: string;
};

type Row = Record<string, unknown> & {
  id: number;
  model_id: number;
  upload_id: number | null;
  old_value: number | null;
  new_value: number | null;
  source: FactAuditSource;
  user_id: number | null;
  created_at: string;
};

function mapRow(r: Row, dims: DimInfo[]): FactAuditEntry {
  const slots = dims.map((d) => d.slot);
  return {
    id: r.id,
    modelId: r.model_id,
    uploadId: r.upload_id,
    coords: slots.map((s) => String(r[`d${s}`] ?? "")),
    oldValue: r.old_value,
    newValue: r.new_value,
    source: r.source,
    userId: r.user_id,
    createdAt: r.created_at,
  };
}

// Bir model icin fact_audit kayitlarini listeler; coordsByDimCode verilirse
// (ör. tek bir hucrenin tam gecmisi) sadece o koordinata ait kayitlar doner.
export function listFactAudit(
  modelId: number,
  opts?: { coordsByDimCode?: Record<string, string>; uploadId?: number; limit?: number }
): FactAuditEntry[] {
  const dims = getModelDims(modelId);
  const where: string[] = ["model_id = ?"];
  const params: unknown[] = [modelId];
  if (opts?.coordsByDimCode) {
    for (const d of dims) {
      const val = opts.coordsByDimCode[d.code];
      if (val != null) {
        where.push(`d${d.slot} = ?`);
        params.push(val);
      }
    }
  }
  if (opts?.uploadId != null) {
    where.push("upload_id = ?");
    params.push(opts.uploadId);
  }
  params.push(opts?.limit ?? 200);
  const rows = sqlite
    .prepare(`SELECT * FROM fact_audit WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .all(...params) as Row[];
  return rows.map((r) => mapRow(r, dims));
}

export function getFactAuditEntry(id: number): FactAuditEntry | null {
  const row = sqlite.prepare("SELECT * FROM fact_audit WHERE id = ?").get(id) as Row | undefined;
  if (!row) return null;
  return mapRow(row, getModelDims(row.model_id));
}

export class FactAuditNotFoundError extends Error {
  constructor() {
    super("Denetim kaydı bulunamadı");
    this.name = "FactAuditNotFoundError";
  }
}

// Tek bir hucre denetim kaydini geri alir:
// - oldValue tanimliysa: o degeri tekrar yazar (upsertFacts uzerinden — bu
//   da yeni bir 'write' kaydi uretir ve lock/is kurali kontrollerinden gecer;
//   kilitli/kural-ihlalli bir geri alma reddedilir).
// - oldValue null ise (hucre o degisiklikten once yoktu): satir silinir ve
//   bu durum 'rollback' kaynakli ayri bir fact_audit kaydiyla belgelenir.
export function rollbackFactAudit(auditId: number, userId: number | null) {
  const entry = getFactAuditEntry(auditId);
  if (!entry) throw new FactAuditNotFoundError();
  const dims = getModelDims(entry.modelId);
  const now = new Date().toISOString();

  if (entry.oldValue == null) {
    const slots = dims.map((d) => d.slot);
    const whereCoord = slots.map((s) => `d${s} = ?`).join(" AND ");
    const current = sqlite
      .prepare(`SELECT value FROM facts WHERE model_id = ? AND ${whereCoord}`)
      .get(entry.modelId, ...entry.coords) as { value: number } | undefined;
    sqlite.prepare(`DELETE FROM facts WHERE model_id = ? AND ${whereCoord}`).run(entry.modelId, ...entry.coords);
    logFactAuditBulk(
      entry.modelId,
      null,
      slots,
      [{ coords: entry.coords, oldValue: current?.value ?? null, newValue: null }],
      "rollback",
      userId,
      now
    );
    return;
  }

  const uploadId = Number(
    sqlite
      .prepare(
        "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
      )
      .run(entry.modelId, `Hücre geri alma #${auditId}`, userId, 1, now).lastInsertRowid
  );
  const fw: FactWrite = { coords: entry.coords, value: entry.oldValue };
  upsertFacts(entry.modelId, dims, [fw], uploadId, now, userId);
}
