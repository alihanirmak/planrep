import { sqlite } from "./db";
import type { DimInfo } from "./model";
import { chunkArray } from "./fact-filters";

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

// Upsert: ayni koordinattaki eski degerler silinir ama uploads.replaced_rows'a
// yedeklenir; geri almada bire bir geri yuklenir.
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
  now: string
) {
  if (rows.length === 0) return;
  const slots = dims.map((d) => d.slot);
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

    sqlite
      .prepare(
        `DELETE FROM facts WHERE model_id = ? AND EXISTS (
           SELECT 1 FROM tmp_upsert_coords WHERE ${joinCond}
         )`
      )
      .run(modelId);

    bulkInsertFacts(modelId, colList, slots.length, rows, uploadId, now);

    sqlite
      .prepare("UPDATE uploads SET replaced_rows = ? WHERE id = ?")
      .run(JSON.stringify(replaced), uploadId);
    sqlite.exec("DROP TABLE IF EXISTS temp.tmp_upsert_coords");
  });
  tx();
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

// Geri alma: upload'in yazdigi satirlar silinir, ezdigi eski degerler geri gelir
export function revertUpload(uploadId: number, modelId: number, dims: DimInfo[]) {
  const slots = dims.map((d) => d.slot);
  const colList = slots.map((s) => `d${s}`).join(",");
  const row = sqlite
    .prepare("SELECT replaced_rows FROM uploads WHERE id = ?")
    .get(uploadId) as { replaced_rows: string | null } | undefined;
  const replaced: ReplacedRow[] = row?.replaced_rows ? JSON.parse(row.replaced_rows) : [];
  const now = new Date().toISOString();

  const tx = sqlite.transaction(() => {
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
  });
  tx();
  return replaced.length;
}
