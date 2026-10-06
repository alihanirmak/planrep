import { sqlite } from "./db";
import type { DimInfo } from "./model";
import { chunkArray } from "./fact-filters";
import { findBlockingLock, WorkflowLockError } from "./workflow";
import { evaluateBusinessRules, BusinessRuleError, type RuleViolation } from "./business-rules";

export type FactWrite = { coords: string[]; value: number };

type ReplacedRow = { coords: string[]; value: number };

// better-sqlite3'un Statement.run/.all tip tanimlari, elimizdeki `unknown[]`
// (tuple olmayan) parametre dizisiyle dogrudan spread edilince TS2556 veriyor;
// apply() ile cagirmak bu kisitlamayi bypass eder.
function runStmt(stmt: ReturnType<typeof sqlite.prepare>, params: unknown[]) {
  return (stmt.run as (...args: unknown[]) => unknown).apply(stmt, params);
}

// Her satirin kac SQL parametresi tasidigina gore guvenli bir toplu-insert
// grup boyutu (eski SQLite surumlerindeki 999 parametre siniri icin savunmaci).
const ROWS_PER_INSERT = 80;

function buildMultiRowInsertSql(colList: string, slotCount: number, rowCount: number): string {
  const rowPlaceholder = `(?, ${Array(slotCount).fill("?").join(",")}, ?, ?, ?)`;
  const values = Array(rowCount).fill(rowPlaceholder).join(", ");
  return `INSERT INTO facts (model_id, ${colList}, value, upload_id, updated_at) VALUES ${values}`;
}

// Bir dizi FactWrite'i, model_id + coords + value + upload_id + updated_at
// siraliyla duzlestirip toplu (multi-row VALUES) INSERT'ler halinde yazar.
function bulkInsertFacts(
  modelId: number,
  colList: string,
  slotCount: number,
  rows: FactWrite[],
  uploadId: number | null,
  now: string
) {
  const stmtCache = new Map<number, ReturnType<typeof sqlite.prepare>>();
  for (const chunk of chunkArray(rows, ROWS_PER_INSERT)) {
    let stmt = stmtCache.get(chunk.length);
    if (!stmt) {
      stmt = sqlite.prepare(buildMultiRowInsertSql(colList, slotCount, chunk.length));
      stmtCache.set(chunk.length, stmt);
    }
    const params: unknown[] = [];
    for (const f of chunk) params.push(modelId, ...f.coords, f.value, uploadId, now);
    runStmt(stmt, params);
  }
}

export type FactAuditSource = "write" | "revert" | "rollback";
type FactAuditEntryInput = { coords: string[]; oldValue: number | null; newValue: number | null };

// Hucre bazli yazma gecmisini (fact_audit) toplu olarak kaydeder.
export function logFactAuditBulk(
  modelId: number,
  uploadId: number | null,
  slots: number[],
  entries: FactAuditEntryInput[],
  source: FactAuditSource,
  userId: number | null,
  now: string
) {
  if (entries.length === 0) return;
  const colList = slots.map((s) => `d${s}`).join(",");
  const stmtCache = new Map<number, ReturnType<typeof sqlite.prepare>>();
  for (const chunk of chunkArray(entries, ROWS_PER_INSERT)) {
    let stmt = stmtCache.get(chunk.length);
    if (!stmt) {
      const rowPlaceholder = `(?, ?, ${Array(slots.length).fill("?").join(",")}, ?, ?, ?, ?, ?)`;
      const values = Array(chunk.length).fill(rowPlaceholder).join(", ");
      stmt = sqlite.prepare(
        `INSERT INTO fact_audit (model_id, upload_id, ${colList}, old_value, new_value, source, user_id, created_at)
         VALUES ${values}`
      );
      stmtCache.set(chunk.length, stmt);
    }
    const params: unknown[] = [];
    for (const e of chunk) {
      params.push(modelId, uploadId, ...e.coords, e.oldValue, e.newValue, source, userId, now);
    }
    runStmt(stmt, params);
  }
}

export type UpsertFactsResult = { warnings: RuleViolation[] };

// Upsert: ayni koordinattaki eski degerler silinir ama uploads.replaced_rows'a
// yedeklenir; geri almada bire bir geri yuklenir. Her satir icin ayrica
// fact_audit'e eski/yeni deger kaydedilir (hucre bazli denetim izi).
//
// Toplu (bulk) strateji: N satir icin eskiden N kez SELECT+DELETE+INSERT
// (3N sorgu) calisiyordu. Simdi: tum yeni koordinatlar bir TEMP tabloya tek
// seferde yazilir, eski degerler TEK bir JOIN sorgusuyla okunur, eski satirlar
// TEK bir EXISTS tabanli DELETE ile silinir, yeni satirlar coklu-satir VALUES
// INSERT'leriyle toplu eklenir (ROWS_PER_INSERT'lik gruplar halinde).
export function upsertFacts(
  modelId: number,
  dims: DimInfo[],
  rows: FactWrite[],
  uploadId: number,
  now: string,
  userId: number | null = null
): UpsertFactsResult {
  if (rows.length === 0) return { warnings: [] };
  const slots = dims.map((d) => d.slot);

  const blocking: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  for (const f of rows) {
    const coordsByDimCode: Record<string, string | undefined> = {};
    dims.forEach((d, i) => {
      coordsByDimCode[d.code] = f.coords[i];
    });
    const blocker = findBlockingLock(modelId, dims, coordsByDimCode);
    if (blocker) throw new WorkflowLockError(blocker.id, blocker.name);
    const result = evaluateBusinessRules(modelId, dims, coordsByDimCode, f.value);
    blocking.push(...result.blocking);
    warnings.push(...result.warnings);
  }
  if (blocking.length > 0) throw new BusinessRuleError(blocking);

  const colList = slots.map((s) => `d${s}`).join(",");
  const joinCond = slots.map((s) => `facts.d${s} = tmp_upsert_coords.d${s}`).join(" AND ");

  const tx = sqlite.transaction(() => {
    sqlite.exec("DROP TABLE IF EXISTS temp.tmp_upsert_coords");
    sqlite.exec(
      `CREATE TEMP TABLE tmp_upsert_coords (${slots.map((s) => `d${s} TEXT`).join(", ")})`
    );
    bulkInsertCoords(slots, rows);

    const olds = sqlite
      .prepare(
        `SELECT ${slots.map((s) => `facts.d${s} AS d${s}`).join(", ")}, facts.value AS value
         FROM facts JOIN tmp_upsert_coords ON ${joinCond}
         WHERE facts.model_id = ?`
      )
      .all(modelId) as Array<Record<string, unknown>>;
    const replaced: ReplacedRow[] = olds.map((o) => ({
      coords: slots.map((s) => String(o[`d${s}`] ?? "")),
      value: Number(o.value),
    }));
    const oldByKey = new Map<string, number>();
    for (const o of replaced) oldByKey.set(o.coords.join("\u0000"), o.value);

    sqlite
      .prepare(
        `DELETE FROM facts WHERE model_id = ? AND EXISTS (
           SELECT 1 FROM tmp_upsert_coords WHERE ${joinCond}
         )`
      )
      .run(modelId);

    bulkInsertFacts(modelId, colList, slots.length, rows, uploadId, now);

    logFactAuditBulk(
      modelId,
      uploadId,
      slots,
      rows.map((f) => ({
        coords: f.coords,
        oldValue: oldByKey.get(f.coords.join("\u0000")) ?? null,
        newValue: f.value,
      })),
      "write",
      userId,
      now
    );

    sqlite
      .prepare("UPDATE uploads SET replaced_rows = ? WHERE id = ?")
      .run(JSON.stringify(replaced), uploadId);
    sqlite.exec("DROP TABLE IF EXISTS temp.tmp_upsert_coords");
  });
  tx();
  return { warnings };
}

function bulkInsertCoords(slots: number[], rows: FactWrite[]) {
  const stmtCache = new Map<number, ReturnType<typeof sqlite.prepare>>();
  for (const chunk of chunkArray(rows, ROWS_PER_INSERT)) {
    let stmt = stmtCache.get(chunk.length);
    if (!stmt) {
      const rowPlaceholder = `(${slots.map(() => "?").join(",")})`;
      const values = Array(chunk.length).fill(rowPlaceholder).join(", ");
      stmt = sqlite.prepare(
        `INSERT INTO tmp_upsert_coords (${slots.map((s) => `d${s}`).join(",")}) VALUES ${values}`
      );
      stmtCache.set(chunk.length, stmt);
    }
    const params: unknown[] = [];
    for (const f of chunk) params.push(...f.coords);
    runStmt(stmt, params);
  }
}

// Geri alma: upload'in yazdigi satirlar silinir, ezdigi eski degerler geri gelir.
// fact_audit'e 'revert' kaynakli kayitlar eklenir: eski deger bu upload'un o
// koordinatta YAZDIGI (simdi silinen) deger, yeni deger geri yuklenen (ya da
// upload'un yeni eklediyse null, yani satir tamamen siliniyor) degerdir.
export function revertUpload(
  uploadId: number,
  modelId: number,
  dims: DimInfo[],
  userId: number | null = null
) {
  const slots = dims.map((d) => d.slot);
  const colList = slots.map((s) => `d${s}`).join(",");
  const row = sqlite
    .prepare("SELECT replaced_rows FROM uploads WHERE id = ?")
    .get(uploadId) as { replaced_rows: string | null } | undefined;
  const replaced: ReplacedRow[] = row?.replaced_rows ? JSON.parse(row.replaced_rows) : [];
  const now = new Date().toISOString();

  const tx = sqlite.transaction(() => {
    const currentRows = sqlite
      .prepare(
        `SELECT ${slots.map((s) => `d${s} AS d${s}`).join(", ")}, value FROM facts WHERE upload_id = ?`
      )
      .all(uploadId) as Array<Record<string, unknown>>;
    const currentByKey = new Map<string, number>();
    for (const r of currentRows) {
      const key = slots.map((s) => String(r[`d${s}`] ?? "")).join("\u0000");
      currentByKey.set(key, Number(r.value));
    }
    const replacedKeys = new Set(replaced.map((r) => r.coords.join("\u0000")));

    sqlite.prepare("DELETE FROM facts WHERE upload_id = ?").run(uploadId);
    if (replaced.length > 0) {
      bulkInsertFacts(
        modelId,
        colList,
        slots.length,
        replaced.map((r) => ({ coords: r.coords, value: r.value })),
        null,
        now
      );
    }
    sqlite.prepare("UPDATE uploads SET status = 'reverted' WHERE id = ?").run(uploadId);

    const auditEntries: FactAuditEntryInput[] = replaced.map((r) => ({
      coords: r.coords,
      oldValue: currentByKey.get(r.coords.join("\u0000")) ?? null,
      newValue: r.value,
    }));
    for (const r of currentRows) {
      const key = slots.map((s) => String(r[`d${s}`] ?? "")).join("\u0000");
      if (replacedKeys.has(key)) continue; // yeni eklenmemis, ustune yazilmis -> yukarida ele alindi
      auditEntries.push({
        coords: slots.map((s) => String(r[`d${s}`] ?? "")),
        oldValue: Number(r.value),
        newValue: null,
      });
    }
    logFactAuditBulk(modelId, null, slots, auditEntries, "revert", userId, now);
  });
  tx();
  return replaced.length;
}
