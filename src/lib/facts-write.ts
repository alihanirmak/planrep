import { sqlite } from "./db";
import type { DimInfo } from "./model";

export type FactWrite = { coords: string[]; value: number };

type ReplacedRow = { coords: string[]; value: number };

// Upsert: ayni koordinattaki eski degerler silinir ama uploads.replaced_rows'a
// yedeklenir; geri almada bire bir geri yuklenir.
export function upsertFacts(
  modelId: number,
  dims: DimInfo[],
  rows: FactWrite[],
  uploadId: number,
  now: string
) {
  const slots = dims.map((d) => d.slot);
  const whereCoord = slots.map((s) => `d${s} = ?`).join(" AND ");
  const colList = slots.map((s) => `d${s}`).join(",");
  const sel = sqlite.prepare(
    `SELECT ${colList}, value FROM facts WHERE model_id = ? AND ${whereCoord}`
  );
  const del = sqlite.prepare(`DELETE FROM facts WHERE model_id = ? AND ${whereCoord}`);
  const ins = sqlite.prepare(
    `INSERT INTO facts (model_id, ${colList}, value, upload_id, updated_at) VALUES (?, ${slots
      .map(() => "?")
      .join(",")}, ?, ?, ?)`
  );

  const replaced: ReplacedRow[] = [];
  const tx = sqlite.transaction(() => {
    for (const f of rows) {
      const olds = sel.all(modelId, ...f.coords) as Array<Record<string, unknown>>;
      for (const o of olds) {
        replaced.push({
          coords: slots.map((s) => String(o[`d${s}`] ?? "")),
          value: Number(o.value),
        });
      }
      del.run(modelId, ...f.coords);
      ins.run(modelId, ...f.coords, f.value, uploadId, now);
    }
    sqlite
      .prepare("UPDATE uploads SET replaced_rows = ? WHERE id = ?")
      .run(JSON.stringify(replaced), uploadId);
  });
  tx();
}

// Geri alma: upload'in yazdigi satirlar silinir, ezdigi eski degerler geri gelir
export function revertUpload(uploadId: number, modelId: number, dims: DimInfo[]) {
  const slots = dims.map((d) => d.slot);
  const colList = slots.map((s) => `d${s}`).join(",");
  const ins = sqlite.prepare(
    `INSERT INTO facts (model_id, ${colList}, value, upload_id, updated_at) VALUES (?, ${slots
      .map(() => "?")
      .join(",")}, ?, NULL, ?)`
  );
  const row = sqlite
    .prepare("SELECT replaced_rows FROM uploads WHERE id = ?")
    .get(uploadId) as { replaced_rows: string | null } | undefined;
  const replaced: ReplacedRow[] = row?.replaced_rows ? JSON.parse(row.replaced_rows) : [];
  const now = new Date().toISOString();

  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM facts WHERE upload_id = ?").run(uploadId);
    for (const r of replaced) {
      ins.run(modelId, ...r.coords, r.value, now);
    }
    sqlite.prepare("UPDATE uploads SET status = 'reverted' WHERE id = ?").run(uploadId);
  });
  tx();
  return replaced.length;
}
