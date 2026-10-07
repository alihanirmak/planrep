import { sqlite } from "./db";

// Model-basina olcu (measure) tanimlari — model_dimensions/MAX_MODEL_DIMENSIONS
// ile BIREBIR AYNI desen (bkz. lib/model.ts). facts/fact_audit tablolarindaki
// value (slot 1) + value2..value8 (slot 2..8) sabit kolonlarina karsilik gelir.
//
// GERIYE UYUMLULUK (kritik tasarim karari): hicbir model icin model_measures
// satiri OLUSTURULMAMISSA, model "varsayilan tekil olcu" moduyla calisir —
// slot 1 "VALUE" adiyla SANAL olarak var sayilir, hicbir DB satirina karsilik
// gelmez. Bu sayede mevcut TUM modeller/route'lar/testler (value kolonunu
// dogrudan okuyan ~20 dosya) HICBIR DEGISIKLIK GEREKTIRMEDEN calismaya devam
// eder — coklu-olcu SADECE bir model icin en az bir measure acikca
// olusturulduysa devreye girer.
export const MAX_MODEL_MEASURES = 8;

export const DEFAULT_MEASURE_CODE = "VALUE";

export type MeasureInfo = {
  id: number;
  modelId: number;
  code: string;
  name: string;
  slot: number;
};

type Row = {
  id: number;
  model_id: number;
  code: string;
  name: string;
  slot: number;
};

function mapRow(r: Row): MeasureInfo {
  return { id: r.id, modelId: r.model_id, code: r.code, name: r.name, slot: r.slot };
}

// Slot numarasindan facts/fact_audit tablosundaki fiziksel deger kolonunun
// adini uretir: slot 1 -> "value" (mevcut kolon, DEGISTIRILMEDI), slot 2..8
// -> "value2".."value8" (yeni eklenen kolonlar).
export function valueColumnForSlot(slot: number): string {
  return slot === 1 ? "value" : `value${slot}`;
}

export function auditColumnsForSlot(slot: number): { old: string; new: string } {
  return slot === 1 ? { old: "old_value", new: "new_value" } : { old: `old_value${slot}`, new: `new_value${slot}` };
}

// Bir model icin GERCEKTEN DB'de tanimli olcu satirlarini doner (bos olabilir).
export function getModelMeasures(modelId: number): MeasureInfo[] {
  return (
    sqlite
      .prepare("SELECT * FROM model_measures WHERE model_id = ? ORDER BY slot")
      .all(modelId) as Row[]
  ).map(mapRow);
}

// Bir model icin ETKIN olcu listesini doner: hic measure tanimlanmamissa
// SANAL varsayilan tekil olcuyu ([{code:"VALUE", slot:1}], id=0) icerir —
// bkz. yukaridaki geriye-uyumluluk notu. upsertFacts/evaluateBusinessRules
// gibi cekirdek fonksiyonlar bu listeyi kullanir.
export function listEffectiveMeasures(modelId: number): MeasureInfo[] {
  const real = getModelMeasures(modelId);
  if (real.length > 0) return real;
  return [{ id: 0, modelId, code: DEFAULT_MEASURE_CODE, name: "Değer", slot: 1 }];
}

export function getMeasure(id: number): MeasureInfo | null {
  const row = sqlite.prepare("SELECT * FROM model_measures WHERE id = ?").get(id) as Row | undefined;
  return row ? mapRow(row) : null;
}

export class MeasureLimitError extends Error {
  constructor() {
    super(`Bir modele en fazla ${MAX_MODEL_MEASURES} ölçü eklenebilir`);
    this.name = "MeasureLimitError";
  }
}

// Yeni bir olcu olusturur, bir sonraki bos slota otomatik atar (model_dimensions
// ile ayni "siraya gore slot" deseni). Modelin ilk olcusu HER ZAMAN slot 1'i
// (mevcut "value" kolonunu) alir — var olan tekil-deger modelleri icin bu,
// o modelin SANAL "VALUE" olcusunu ARTIK ACIKCA ADLANDIRILMIS bir satira
// donusturur (fiziksel veri/kolon degismez, sadece isimlendirme kalicilasir).
export function createModelMeasure(input: { modelId: number; code: string; name: string }): MeasureInfo {
  const existing = getModelMeasures(input.modelId);
  if (existing.length >= MAX_MODEL_MEASURES) throw new MeasureLimitError();
  const usedSlots = new Set(existing.map((m) => m.slot));
  let slot = 1;
  while (usedSlots.has(slot)) slot++;
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO model_measures (model_id, code, name, slot, created_at) VALUES (?,?,?,?,?)"
      )
      .run(input.modelId, input.code, input.name, slot, now).lastInsertRowid
  );
  return getMeasure(id)!;
}

export function updateMeasure(id: number, patch: { name?: string }): MeasureInfo | null {
  sqlite.prepare("UPDATE model_measures SET name = COALESCE(?, name) WHERE id = ?").run(patch.name ?? null, id);
  return getMeasure(id);
}

export class MeasureInUseError extends Error {
  constructor() {
    super("Bu ölçü iş kuralları tarafından kullanılıyor");
    this.name = "MeasureInUseError";
  }
}

export class PrimaryMeasureInUseError extends Error {
  constructor() {
    super(
      "Slot 1'deki (ana) ölçü, diğer ölçüler varken silinemez — facts.value kolonu NOT NULL olduğundan önce diğer ölçüler silinmeli"
    );
    this.name = "PrimaryMeasureInUseError";
  }
}

// Bir olcuyu siler. Guvenlik notlari:
// 1. Is kurallari (business_rules.measure_code) bu olcuyu referans
//    gosteriyorsa silme reddedilir (dimensions'daki ref_in_use kontroluyle
//    AYNI desen).
// 2. KRITIK: slot 1'deki olcu (facts.value kolonu — NOT NULL kisitli),
//    model_measures'ta BASKA olcu (slot 2+) kalmisken silinemez. Aksi halde
//    listEffectiveMeasures artik slot 1'i DONDURMEZ (sadece kalan slotlari
//    dondurur), bulkInsertFacts'in urettigi INSERT ifadesi "value" kolonunu
//    HIC ICERMEZ ve bir sonraki upsertFacts cagrisi NOT NULL constraint
//    ihlaliyle patlar. Fiziksel kolondaki (orn. value3) VERI silinmez —
//    sadece tanim kaldirilir, kolon "yetim" (artik hicbir measure'a bagli
//    degil) kalir; bu kasitli (veri kaybini onlemek icin), gerekirse ayri
//    bir temizlik islemi (facts tablosunda o kolonu NULL'lama) admin
//    tarafindan tetiklenebilir.
export function deleteModelMeasure(id: number) {
  const measure = getMeasure(id);
  if (!measure) return;
  const inUse = sqlite
    .prepare("SELECT COUNT(*) AS c FROM business_rules WHERE measure_code = ? AND model_id = ?")
    .get(measure.code, measure.modelId) as { c: number };
  if (inUse.c > 0) throw new MeasureInUseError();
  if (measure.slot === 1) {
    const others = sqlite
      .prepare("SELECT COUNT(*) AS c FROM model_measures WHERE model_id = ? AND id != ?")
      .get(measure.modelId, id) as { c: number };
    if (others.c > 0) throw new PrimaryMeasureInUseError();
  }
  sqlite.prepare("DELETE FROM model_measures WHERE id = ?").run(id);
}
