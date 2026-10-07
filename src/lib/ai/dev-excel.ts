import ExcelJS from "exceljs";
import { parseLocaleNumber } from "../number";
import type { ModelInfo } from "../model";
import type { DevPlan, UploadFactsRow } from "./dev-actions";

// Excel sablonundan (ilk sheet, 1. satir baslik) bir DevPlan cikarir —
// SEZGISEL/DETERMINISTIK bir ayristirma, LLM GEREKTIRMEZ (axet'ten
// bagimsiz calisir). Her kolon ya bir BOYUT (coklu tekrarli metin/kod
// degerleri) ya da bir OLCU (sayisal degerler) olarak sinflandirilir.
// modelCodeHint verilip tenant'ta zaten o kod ile bir model varsa, o
// modelin MEVCUT boyut/olculeri (baslik adi/kod eslesmesiyle) yeniden
// KULLANILIR — sadece eslesmeyen basliklar icin yeni boyut/olcu onerilir.
// Hicbir sey otomatik yazilmaz: cikan DevPlan, mevcut onay akisindan
// (plan -> onizle -> uygula) GECMEK ZORUNDADIR.

export type ExcelPlanResult = { plan: DevPlan } | { error: string };

function sanitizeCode(raw: string): string {
  const upper = raw
    .trim()
    .toLocaleUpperCase("tr")
    .replace(/[İI]/g, "I")
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return upper || "COL";
}

// Kolonun OLCU mu (sayisal) yoksa BOYUT mu (metin/kod) oldugunu belirlemek
// icin KASITLI OLARAK siki bir regex kullanilir — parseLocaleNumber TOO
// PERMISSIVE olurdu (orn. "2026-01" gibi bir zaman kodundaki "-" karakteri
// binlik/eksi isareti sanilip "202601" olarak sayisal okunurdu). Sadece
// gercekten "duz sayi" gorunumlu metinler (ondalik virgul/nokta + opsiyonel
// basta eksi, ARA KARAKTER YOK) olcu say1l1r.
const STRICT_NUMERIC = /^-?\d+([.,]\d+)?$/;

function looksNumeric(raw: ExcelJS.CellValue): boolean {
  if (typeof raw === "number") return true;
  const text = cellText(raw);
  return text !== "" && STRICT_NUMERIC.test(text);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

// Ayni metin degerinin farkli iki degeri (orn. "A-B" ve "A_B") ayni koda
// sanitize olabilir — bu durumda ilk goruleni tutar, cakisan digerlerini
// sessizce atar (uye kodu benzersizligini korumak icin, bkz. yukaridaki
// create_dimension dogrulamasi).
function dedupeByCode<T extends { code: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    out.push(item);
  }
  return out;
}

export async function parseExcelToDevPlan(
  buffer: ArrayBuffer,
  options: { modelCodeHint?: string; modelNameHint?: string; existingModels: ModelInfo[] }
): Promise<ExcelPlanResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { error: "invalid_file" };
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) return { error: "empty_file" };

  const headerRow = ws.getRow(1);
  const headers: Array<{ col: number; text: string }> = [];
  headerRow.eachCell((cell, colNumber) => {
    const text = cellText(cell.value);
    if (text) headers.push({ col: colNumber, text });
  });
  if (headers.length === 0) return { error: "empty_file" };

  // Her kolonun sayisal mi (olcu) yoksa metin/kod mu (boyut) oldugunu,
  // veri satirlarinin coguna bakarak belirler.
  const sampleRows: ExcelJS.Row[] = [];
  for (let r = 2; r <= Math.min(ws.rowCount, 200); r++) {
    const row = ws.getRow(r);
    if (row.hasValues) sampleRows.push(row);
  }
  if (sampleRows.length === 0) return { error: "empty_file" };

  const existingModel = options.modelCodeHint
    ? options.existingModels.find((m) => m.code === options.modelCodeHint!.toUpperCase())
    : undefined;

  type ColInfo = {
    col: number;
    header: string;
    code: string;
    isMeasure: boolean;
    existingDimCode?: string;
    existingMeasureCode?: string;
  };
  const cols: ColInfo[] = headers.map((h) => {
    let numericHits = 0;
    for (const row of sampleRows) {
      if (looksNumeric(row.getCell(h.col).value)) numericHits++;
    }
    const isMeasure = numericHits / sampleRows.length > 0.8;
    const code = sanitizeCode(h.text);
    const existingDim = !isMeasure
      ? existingModel?.dims.find(
          (d) => d.code === code || d.name.toLocaleUpperCase("tr") === h.text.toLocaleUpperCase("tr")
        )
      : undefined;
    const existingMeasure = isMeasure
      ? existingModel?.measures?.find(
          (m) => m.code === code || m.name.toLocaleUpperCase("tr") === h.text.toLocaleUpperCase("tr")
        )
      : undefined;
    return {
      col: h.col,
      header: h.text,
      code: existingDim?.code ?? existingMeasure?.code ?? code,
      isMeasure,
      existingDimCode: existingDim?.code,
      existingMeasureCode: existingMeasure?.code,
    };
  });

  const dimCols = cols.filter((c) => !c.isMeasure);
  const measureCols = cols.filter((c) => c.isMeasure);
  if (dimCols.length === 0) return { error: "no_dimension_columns" };
  if (measureCols.length === 0) return { error: "no_measure_columns" };

  const actions: DevPlan["actions"] = [];

  // Yeni boyutlar (mevcut modelin boyutlarindan eslesmeyenler)
  for (const c of dimCols) {
    if (c.existingDimCode) continue;
    const uniqueValues = new Map<string, string>();
    for (const row of sampleRows) {
      const text = cellText(row.getCell(c.col).value);
      if (text && !uniqueValues.has(text)) uniqueValues.set(text, text);
    }
    // Tum satirlar (ornekleme disinda kalanlar dahil) icin de uye kodu
    // uretilmesi gerekiyorsa asagidaki fact satirlarinda ayni sanitizeCode
    // kullanilir — burada SADECE tanim (dimension+members) olusturuluyor.
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      const text = cellText(row.getCell(c.col).value);
      if (text && !uniqueValues.has(text)) uniqueValues.set(text, text);
    }
    actions.push({
      type: "create_dimension",
      code: c.code,
      name: c.header,
      dimType: "standard",
      members: dedupeByCode([...uniqueValues.values()].map((v) => ({ code: sanitizeCode(v), name: v }))),
    });
  }

  // Model (yoksa yeni, varsa referans)
  const modelCode = existingModel?.code ?? sanitizeCode(options.modelCodeHint || options.modelNameHint || "MODEL");
  if (!existingModel) {
    actions.push({
      type: "create_model",
      code: modelCode,
      name: options.modelNameHint || modelCode,
      description: null,
      dimensionCodes: dimCols.map((c) => c.code),
    });
  }

  // Yeni olculer (mevcut modelin olculerinden eslesmeyenler). Modelin
  // SIRADAKI (ilk) olcusu "birincil" (slot 1) kabul edilir — model yeni
  // ise create_measure cagirmaya GEREK YOK (slot 1 upsertFacts'in "value"
  // alanindan otomatik gelir, bkz. lib/model-measures.ts), sadece IKINCI
  // ve sonraki olculer icin create_measure gerekir.
  const newMeasureCols = measureCols.filter((c) => !c.existingMeasureCode);
  const measuresNeedingAction = existingModel ? newMeasureCols : newMeasureCols.slice(1);
  for (const c of measuresNeedingAction) {
    actions.push({ type: "create_measure", modelCode, code: c.code, name: c.header });
  }

  const primaryMeasure = measureCols[0];
  const otherMeasures = measureCols.slice(1);

  const factRows: UploadFactsRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    const coords: Record<string, string> = {};
    for (const c of dimCols) {
      const text = cellText(row.getCell(c.col).value);
      coords[c.code] = sanitizeCode(text);
    }
    const rawPrimary = row.getCell(primaryMeasure.col).value;
    const value = typeof rawPrimary === "number" ? rawPrimary : parseLocaleNumber(cellText(rawPrimary));
    if (Number.isNaN(value)) continue;
    const values: Record<string, number> = {};
    for (const c of otherMeasures) {
      const raw = row.getCell(c.col).value;
      const num = typeof raw === "number" ? raw : parseLocaleNumber(cellText(raw));
      if (!Number.isNaN(num)) values[c.code] = num;
    }
    factRows.push({ coords, value, values: Object.keys(values).length > 0 ? values : undefined });
  }
  if (factRows.length === 0) return { error: "empty_file" };

  actions.push({ type: "upload_facts", modelCode, rows: factRows });

  return {
    plan: {
      summary: `Excel şablonundan: ${dimCols.length} boyut, ${measureCols.length} ölçü, ${factRows.length} veri satırı`,
      actions,
    },
  };
}
