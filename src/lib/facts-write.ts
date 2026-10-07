import { sqlite } from "./db";
import type { DimInfo } from "./model";
import { chunkArray } from "./fact-filters";
import { findBlockingLock, WorkflowLockError } from "./workflow";
import { evaluateBusinessRules, BusinessRuleError, type RuleViolation } from "./business-rules";
import { cacheDeleteByPrefix } from "./cache";
import { listEffectiveMeasures, valueColumnForSlot, auditColumnsForSlot } from "./model-measures";

// upsertFacts/revertUpload bu modelin tum pivot/query cache sonuclarini
// gecersiz kilar — veri degistigi icin TTL dolana kadar bekletmek yerine
// (bkz. api/pivot/route.ts, api/query/route.ts) hemen invalidate edilir.
// Fire-and-forget (await edilmez): invalidation basarisiz olsa bile en
// kotu ihtimalle TTL (60sn) dolana kadar bayat sonuc donebilir, yazma
// isleminin kendisi hicbir zaman bu yuzden geciktirilmez/basarisiz olmaz.
function invalidateModelCache(modelId: number) {
  cacheDeleteByPrefix(`pivot:v1:${modelId}:`).catch(() => {});
  cacheDeleteByPrefix(`query:v1:${modelId}:`).catch(() => {});
}

// value: slot 1 (facts.value kolonu) — ZORUNLU, DEGISTIRILMEDI (geriye
// uyumluluk). values: slot 2..8 icin opsiyonel ek olcu degerleri — bir slot
// haritada yoksa veya null ise o olcu icin NULL yazilir (bu fonksiyon satiri
// TAMAMEN SIL-YENIDEN-YAZ semantigiyle calistigindan "degismeden kalma" diye
// bir ara durum yok, bkz. asagidaki upsertFacts yorumu).
export type FactWrite = { coords: string[]; value: number; values?: Record<number, number | null> };

type ReplacedRow = { coords: string[]; value: number; values?: Record<number, number | null> };

// better-sqlite3'un Statement.run/.all tip tanimlari, elimizdeki `unknown[]`
// (tuple olmayan) parametre dizisiyle dogrudan spread edilince TS2556 veriyor;
// apply() ile cagirmak bu kisitlamayi bypass eder.
function runStmt(stmt: ReturnType<typeof sqlite.prepare>, params: unknown[]) {
  return (stmt.run as (...args: unknown[]) => unknown).apply(stmt, params);
}

// Her satirin kac SQL parametresi tasidigina gore guvenli bir toplu-insert
// grup boyutu (eski SQLite surumlerindeki 999 parametre siniri icin savunmaci).
const ROWS_PER_INSERT = 80;

function buildMultiRowInsertSql(
  colList: string,
  slotCount: number,
  measureSlots: number[],
  rowCount: number
): string {
  const measureColList = measureSlots.map(valueColumnForSlot).join(",");
  const rowPlaceholder = `(?, ${Array(slotCount).fill("?").join(",")}, ${measureSlots
    .map(() => "?")
    .join(",")}, ?, ?)`;
  const values = Array(rowCount).fill(rowPlaceholder).join(", ");
  return `INSERT INTO facts (model_id, ${colList}, ${measureColList}, upload_id, updated_at) VALUES ${values}`;
}

// Bir dizi FactWrite'i, model_id + coords + (olcu slotlari) + upload_id +
// updated_at siraliyla duzlestirip toplu (multi-row VALUES) INSERT'ler
// halinde yazar. measureSlots sirali ([1] veya [1,2,3,...]) — slot 1 her
// zaman f.value'den gelir, digerleri f.values[slot]'tan (yoksa/null ise NULL).
function bulkInsertFacts(
  modelId: number,
  colList: string,
  slotCount: number,
  measureSlots: number[],
  rows: FactWrite[],
  uploadId: number | null,
  now: string
) {
  const stmtCache = new Map<number, ReturnType<typeof sqlite.prepare>>();
  for (const chunk of chunkArray(rows, ROWS_PER_INSERT)) {
    let stmt = stmtCache.get(chunk.length);
    if (!stmt) {
      stmt = sqlite.prepare(buildMultiRowInsertSql(colList, slotCount, measureSlots, chunk.length));
      stmtCache.set(chunk.length, stmt);
    }
    const params: unknown[] = [];
    for (const f of chunk) {
      params.push(modelId, ...f.coords);
      for (const slot of measureSlots) {
        params.push(slot === 1 ? f.value : f.values?.[slot] ?? null);
      }
      params.push(uploadId, now);
    }
    runStmt(stmt, params);
  }
}

export type FactAuditSource = "write" | "revert" | "rollback";
export type FactAuditEntryInput = {
  coords: string[];
  oldValue: number | null;
  newValue: number | null;
  // Sadece modelin birden fazla olcusu varsa doldurulur (slot -> deger).
  oldValues?: Record<number, number | null>;
  newValues?: Record<number, number | null>;
};

// Hucre bazli yazma gecmisini (fact_audit) toplu olarak kaydeder. measureSlots
// sirali ([1] veya [1,2,...]) — slot 1 her zaman oldValue/newValue'dan gelir,
// digerleri oldValues/newValues[slot]'tan.
export function logFactAuditBulk(
  modelId: number,
  uploadId: number | null,
  slots: number[],
  measureSlots: number[],
  entries: FactAuditEntryInput[],
  source: FactAuditSource,
  userId: number | null,
  now: string
) {
  if (entries.length === 0) return;
  const colList = slots.map((s) => `d${s}`).join(",");
  const measureColList = measureSlots
    .map((s) => {
      const { old, new: n } = auditColumnsForSlot(s);
      return `${old},${n}`;
    })
    .join(",");
  const stmtCache = new Map<number, ReturnType<typeof sqlite.prepare>>();
  for (const chunk of chunkArray(entries, ROWS_PER_INSERT)) {
    let stmt = stmtCache.get(chunk.length);
    if (!stmt) {
      const rowPlaceholder = `(?, ?, ${Array(slots.length).fill("?").join(",")}, ${measureSlots
        .map(() => "?,?")
        .join(",")}, ?, ?, ?)`;
      const values = Array(chunk.length).fill(rowPlaceholder).join(", ");
      stmt = sqlite.prepare(
        `INSERT INTO fact_audit (model_id, upload_id, ${colList}, ${measureColList}, source, user_id, created_at)
         VALUES ${values}`
      );
      stmtCache.set(chunk.length, stmt);
    }
    const params: unknown[] = [];
    for (const e of chunk) {
      params.push(modelId, uploadId, ...e.coords);
      for (const slot of measureSlots) {
        if (slot === 1) params.push(e.oldValue, e.newValue);
        else params.push(e.oldValues?.[slot] ?? null, e.newValues?.[slot] ?? null);
      }
      params.push(source, userId, now);
    }
    runStmt(stmt, params);
  }
}

export type UpsertFactsResult = { warnings: RuleViolation[] };

// Upsert: ayni koordinattaki eski degerler silinir ama uploads.replaced_rows'a
// yedeklenir; geri almada bire bir geri yuklenir. Her satir icin ayrica
// fact_audit'e eski/yeni deger kaydedilir (hucre bazli denetim izi).
//
// COKLU-OLCU NOTU: modelin kac olcusu oldugu (listEffectiveMeasures) her
// cagrida DB'den okunur. Tek-olcu modellerde (buyuk cogunluk) measureSlots
// hep [1] olur ve asagidaki tum "slot > 1" kod yollari devreye GIRMEZ —
// davranis bu degisiklikten ONCEki ile BIREBIR AYNI kalir. Bir satir bir
// olcuyu f.values'ta BELIRTMEMISSE o olcu icin NULL yazilir (TAM SATIR
// SIL-YENIDEN-YAZ semantigi — "degismeden kalma" ara durumu yok, coklu-olcu
// yazarken HER olcuyu birlikte gondermek cagiranin sorumlulugundadir).
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
  const measures = listEffectiveMeasures(modelId);
  const measureSlots = measures.map((m) => m.slot);
  const measureCodeBySlot = new Map(measures.map((m) => [m.slot, m.code]));

  const blocking: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  for (const f of rows) {
    const coordsByDimCode: Record<string, string | undefined> = {};
    dims.forEach((d, i) => {
      coordsByDimCode[d.code] = f.coords[i];
    });
    const blocker = findBlockingLock(modelId, dims, coordsByDimCode);
    if (blocker) throw new WorkflowLockError(blocker.id, blocker.name);
    for (const slot of measureSlots) {
      const val = slot === 1 ? f.value : f.values?.[slot];
      if (val == null) continue;
      const result = evaluateBusinessRules(modelId, dims, coordsByDimCode, val, measureCodeBySlot.get(slot));
      blocking.push(...result.blocking);
      warnings.push(...result.warnings);
    }
  }
  if (blocking.length > 0) throw new BusinessRuleError(blocking);

  const colList = slots.map((s) => `d${s}`).join(",");
  const joinCond = slots.map((s) => `facts.d${s} = tmp_upsert_coords.d${s}`).join(" AND ");
  const measureSelCols = measureSlots
    .map((s) => `facts.${valueColumnForSlot(s)} AS ${valueColumnForSlot(s)}`)
    .join(", ");

  const tx = sqlite.transaction(() => {
    sqlite.exec("DROP TABLE IF EXISTS temp.tmp_upsert_coords");
    sqlite.exec(
      `CREATE TEMP TABLE tmp_upsert_coords (${slots.map((s) => `d${s} TEXT`).join(", ")})`
    );
    bulkInsertCoords(slots, rows);

    const olds = sqlite
      .prepare(
        `SELECT ${slots.map((s) => `facts.d${s} AS d${s}`).join(", ")}, ${measureSelCols}
         FROM facts JOIN tmp_upsert_coords ON ${joinCond}
         WHERE facts.model_id = ?`
      )
      .all(modelId) as Array<Record<string, unknown>>;
    const replaced: ReplacedRow[] = olds.map((o) => {
      const coords = slots.map((s) => String(o[`d${s}`] ?? ""));
      const value = Number(o[valueColumnForSlot(1)]);
      if (measureSlots.length <= 1) return { coords, value };
      const values: Record<number, number | null> = {};
      for (const s of measureSlots) {
        if (s === 1) continue;
        const raw = o[valueColumnForSlot(s)];
        values[s] = raw == null ? null : Number(raw);
      }
      return { coords, value, values };
    });
    const oldByKey = new Map<string, ReplacedRow>();
    for (const o of replaced) oldByKey.set(o.coords.join("\u0000"), o);

    sqlite
      .prepare(
        `DELETE FROM facts WHERE model_id = ? AND EXISTS (
           SELECT 1 FROM tmp_upsert_coords WHERE ${joinCond}
         )`
      )
      .run(modelId);

    bulkInsertFacts(modelId, colList, slots.length, measureSlots, rows, uploadId, now);

    const auditEntries: FactAuditEntryInput[] = rows.map((f) => {
      const old = oldByKey.get(f.coords.join("\u0000"));
      const base: FactAuditEntryInput = {
        coords: f.coords,
        oldValue: old?.value ?? null,
        newValue: f.value,
      };
      if (measureSlots.length <= 1) return base;
      const oldValues: Record<number, number | null> = {};
      const newValues: Record<number, number | null> = {};
      for (const s of measureSlots) {
        if (s === 1) continue;
        oldValues[s] = old?.values?.[s] ?? null;
        newValues[s] = f.values?.[s] ?? null;
      }
      return { ...base, oldValues, newValues };
    });
    logFactAuditBulk(modelId, uploadId, slots, measureSlots, auditEntries, "write", userId, now);

    sqlite
      .prepare("UPDATE uploads SET replaced_rows = ? WHERE id = ?")
      .run(JSON.stringify(replaced), uploadId);
    sqlite.exec("DROP TABLE IF EXISTS temp.tmp_upsert_coords");
  });
  tx();
  invalidateModelCache(modelId);
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
  const measures = listEffectiveMeasures(modelId);
  const measureSlots = measures.map((m) => m.slot);
  const measureSelCols = measureSlots.map((s) => `${valueColumnForSlot(s)} AS ${valueColumnForSlot(s)}`).join(", ");
  const row = sqlite
    .prepare("SELECT replaced_rows FROM uploads WHERE id = ?")
    .get(uploadId) as { replaced_rows: string | null } | undefined;
  const replaced: ReplacedRow[] = row?.replaced_rows ? JSON.parse(row.replaced_rows) : [];
  const now = new Date().toISOString();

  const tx = sqlite.transaction(() => {
    const currentRows = sqlite
      .prepare(
        `SELECT ${slots.map((s) => `d${s} AS d${s}`).join(", ")}, ${measureSelCols} FROM facts WHERE upload_id = ?`
      )
      .all(uploadId) as Array<Record<string, unknown>>;
    const currentByKey = new Map<string, ReplacedRow>();
    for (const r of currentRows) {
      const key = slots.map((s) => String(r[`d${s}`] ?? "")).join("\u0000");
      const value = Number(r[valueColumnForSlot(1)]);
      if (measureSlots.length <= 1) {
        currentByKey.set(key, { coords: [], value });
        continue;
      }
      const values: Record<number, number | null> = {};
      for (const s of measureSlots) {
        if (s === 1) continue;
        const raw = r[valueColumnForSlot(s)];
        values[s] = raw == null ? null : Number(raw);
      }
      currentByKey.set(key, { coords: [], value, values });
    }
    const replacedKeys = new Set(replaced.map((r) => r.coords.join("\u0000")));

    sqlite.prepare("DELETE FROM facts WHERE upload_id = ?").run(uploadId);
    if (replaced.length > 0) {
      bulkInsertFacts(
        modelId,
        colList,
        slots.length,
        measureSlots,
        replaced.map((r) => ({ coords: r.coords, value: r.value, values: r.values })),
        null,
        now
      );
    }
    sqlite.prepare("UPDATE uploads SET status = 'reverted' WHERE id = ?").run(uploadId);

    const auditEntries: FactAuditEntryInput[] = replaced.map((r) => {
      const current = currentByKey.get(r.coords.join("\u0000"));
      const base: FactAuditEntryInput = {
        coords: r.coords,
        oldValue: current?.value ?? null,
        newValue: r.value,
      };
      if (measureSlots.length <= 1) return base;
      const oldValues: Record<number, number | null> = {};
      const newValues: Record<number, number | null> = {};
      for (const s of measureSlots) {
        if (s === 1) continue;
        oldValues[s] = current?.values?.[s] ?? null;
        newValues[s] = r.values?.[s] ?? null;
      }
      return { ...base, oldValues, newValues };
    });
    for (const r of currentRows) {
      const key = slots.map((s) => String(r[`d${s}`] ?? "")).join("\u0000");
      if (replacedKeys.has(key)) continue; // yeni eklenmemis, ustune yazilmis -> yukarida ele alindi
      const current = currentByKey.get(key)!;
      const base: FactAuditEntryInput = {
        coords: slots.map((s) => String(r[`d${s}`] ?? "")),
        oldValue: current.value,
        newValue: null,
      };
      if (measureSlots.length <= 1) {
        auditEntries.push(base);
        continue;
      }
      const oldValues: Record<number, number | null> = {};
      const newValues: Record<number, number | null> = {};
      for (const s of measureSlots) {
        if (s === 1) continue;
        oldValues[s] = current.values?.[s] ?? null;
        newValues[s] = null;
      }
      auditEntries.push({ ...base, oldValues, newValues });
    }
    logFactAuditBulk(modelId, null, slots, measureSlots, auditEntries, "revert", userId, now);
  });
  tx();
  invalidateModelCache(modelId);
  return replaced.length;
}
