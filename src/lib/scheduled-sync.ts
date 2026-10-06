import { sqlite } from "./db";
import { runConnectorImport } from "./integrations/run-import";

export type ScheduledSync = {
  id: number;
  tenantId: number;
  name: string;
  connectorConfigId: number;
  source: string;
  modelId: number;
  mapping: Record<string, string>;
  intervalMinutes: number;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: "success" | "failed" | null;
  lastError: string | null;
  lastInserted: number | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: number;
  tenant_id: number;
  name: string;
  connector_config_id: number;
  source: string;
  model_id: number;
  mapping: string;
  interval_minutes: number;
  active: number;
  last_run_at: string | null;
  last_status: "success" | "failed" | null;
  last_error: string | null;
  last_inserted: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
};

function mapRow(r: Row): ScheduledSync {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    connectorConfigId: r.connector_config_id,
    source: r.source,
    modelId: r.model_id,
    mapping: JSON.parse(r.mapping) as Record<string, string>,
    intervalMinutes: r.interval_minutes,
    active: r.active === 1,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    lastInserted: r.last_inserted,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listScheduledSyncs(filter?: { tenantId?: number }): ScheduledSync[] {
  if (filter?.tenantId != null) {
    const rows = sqlite
      .prepare("SELECT * FROM scheduled_syncs WHERE tenant_id = ? ORDER BY id DESC")
      .all(filter.tenantId) as Row[];
    return rows.map(mapRow);
  }
  const rows = sqlite.prepare("SELECT * FROM scheduled_syncs ORDER BY id DESC").all() as Row[];
  return rows.map(mapRow);
}

export function getScheduledSync(id: number): ScheduledSync | null {
  const row = sqlite.prepare("SELECT * FROM scheduled_syncs WHERE id = ?").get(id) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function createScheduledSync(input: {
  tenantId: number;
  name: string;
  connectorConfigId: number;
  source: string;
  modelId: number;
  mapping: Record<string, string>;
  intervalMinutes: number;
  createdBy: number;
}): ScheduledSync {
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO scheduled_syncs
           (tenant_id, name, connector_config_id, source, model_id, mapping, interval_minutes, active, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,1,?,?,?)`
      )
      .run(
        input.tenantId,
        input.name,
        input.connectorConfigId,
        input.source,
        input.modelId,
        JSON.stringify(input.mapping),
        input.intervalMinutes,
        input.createdBy,
        now,
        now
      ).lastInsertRowid
  );
  return getScheduledSync(id)!;
}

export function updateScheduledSync(
  id: number,
  patch: Partial<{
    name: string;
    source: string;
    mapping: Record<string, string>;
    intervalMinutes: number;
    active: boolean;
  }>
): ScheduledSync | null {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE scheduled_syncs SET
         name = COALESCE(?, name),
         source = COALESCE(?, source),
         mapping = COALESCE(?, mapping),
         interval_minutes = COALESCE(?, interval_minutes),
         active = COALESCE(?, active),
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? null,
      patch.source ?? null,
      patch.mapping != null ? JSON.stringify(patch.mapping) : null,
      patch.intervalMinutes ?? null,
      patch.active != null ? (patch.active ? 1 : 0) : null,
      now,
      id
    );
  return getScheduledSync(id);
}

export function deleteScheduledSync(id: number) {
  sqlite.prepare("DELETE FROM scheduled_syncs WHERE id = ?").run(id);
}

function recordRunResult(
  id: number,
  status: "success" | "failed",
  error: string | null,
  inserted: number | null
) {
  sqlite
    .prepare(
      `UPDATE scheduled_syncs SET last_run_at = ?, last_status = ?, last_error = ?, last_inserted = ? WHERE id = ?`
    )
    .run(new Date().toISOString(), status, error, inserted, id);
}

export type ScheduledSyncRunOutcome = {
  id: number;
  name: string;
  status: "success" | "failed";
  inserted: number | null;
  error: string | null;
};

// Tek bir zamanlanmis senkronizasyonu, kaydedilmis connector/source/model/
// mapping bilgisiyle calistirir (manuel import ile AYNI cekirdek fonksiyon —
// runConnectorImport). Sonucu kayda (last_run_at/last_status/last_error/
// last_inserted) yazar; aktif olmayan bir kayit icin calistirilsa da sonuc
// kaydedilir (manuel "şimdi çalıştır" butonu aktif/pasif'ten bagimsiz
// calisabilsin diye bu fonksiyon active kontrolu yapmaz — o kontrol
// findDueScheduledSyncs'te).
export async function runScheduledSync(id: number): Promise<ScheduledSyncRunOutcome> {
  const sync = getScheduledSync(id);
  if (!sync) {
    throw new Error(`Zamanlanmış senkronizasyon bulunamadı: ${id}`);
  }
  const result = await runConnectorImport({
    tenantId: sync.tenantId,
    connectorConfigId: sync.connectorConfigId,
    source: sync.source,
    modelId: sync.modelId,
    mapping: sync.mapping,
    userId: sync.createdBy,
    uploadLabel: `Zamanlanmış senkronizasyon: ${sync.name}`,
  });

  if (result.ok) {
    recordRunResult(id, "success", null, result.inserted);
    return { id, name: sync.name, status: "success", inserted: result.inserted, error: null };
  }

  const errorMessage =
    result.error === "validation"
      ? result.errors.join("; ")
      : "message" in result
        ? result.message
        : result.error;
  recordRunResult(id, "failed", errorMessage, null);
  return { id, name: sync.name, status: "failed", inserted: null, error: errorMessage };
}

// "Vadesi gelmis" (interval_minutes suresi dolmus veya hic calismamis) aktif
// senkronizasyonlari bulur. Harici bir cron/webhook cagrisi (POST /api/cron/sync)
// bunlari sirayla calistirmak icin kullanir.
export function findDueScheduledSyncs(now: Date = new Date()): ScheduledSync[] {
  return listScheduledSyncs().filter((s) => {
    if (!s.active) return false;
    if (!s.lastRunAt) return true;
    const elapsedMs = now.getTime() - new Date(s.lastRunAt).getTime();
    return elapsedMs >= s.intervalMinutes * 60 * 1000;
  });
}

// Vadesi gelmis tum aktif senkronizasyonlari SIRAYLA (paralel degil — ayni
// SQLite dosyasina yazma celismesini onlemek icin) calistirir.
export async function runDueScheduledSyncs(): Promise<ScheduledSyncRunOutcome[]> {
  const due = findDueScheduledSyncs();
  const outcomes: ScheduledSyncRunOutcome[] = [];
  for (const sync of due) {
    outcomes.push(await runScheduledSync(sync.id));
  }
  return outcomes;
}
