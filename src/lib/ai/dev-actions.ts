import { z } from "zod";
import { sqlite } from "../db";
import { MAX_MODEL_DIMENSIONS, getModelDims } from "../model";
import { MAX_MODEL_MEASURES, listEffectiveMeasures, createModelMeasure } from "../model-measures";
import { upsertFacts } from "../facts-write";
import { logAudit } from "../audit";
import { runQuery } from "../query";
import { runAxet, axetAvailable } from "./axet-cli";
import { extractJson } from "./nl2report";
import { getServerT } from "../i18n-server";
import { versionedUpdate } from "../version-guard";
import type { ReportDefV2 } from "../report-types";
import type { Role } from "../session";

// ============================================================================
// AI ile Gelistirme (chat/Excel ile model/boyut/olcu/rapor/veri olusturma) —
// GUVENLIK CEKIRDEGI. Bu dosya ASLA genisletilip "serbest SQL/kod calistir"
// gibi bir eylem turu EKLENMEMELI — tasarimin tum guvenligi, AI'nin SADECE
// burada tanimli sabit, parametreli eylem turlerinden (DevAction) birini
// secebilmesine dayanir. Her eylem, karsilik geldigi REST route'un (orn.
// /api/models POST) AYNI dogrulama/limit/rol kontrolunu uygular — AI, bir
// insanin UI uzerinden yapabileceginden FAZLASINI YAPAMAZ. is kurallari
// (business_rules), kullanici/rol yonetimi, connector/scheduled-sync, model/
// boyut SILME gibi islemler KASITLI OLARAK buraya eklenmedi (bkz.
// docs/ROADMAP.md "AI ile gelistirme" maddesi).
// ============================================================================

const codeSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_]+$/, "Kod sadece harf/rakam/alt çizgi içerebilir");

const memberSchema = z.object({
  code: codeSchema,
  name: z.string().min(1).max(120),
  parentCode: z.string().nullish(),
});

export const devActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_dimension"),
    code: codeSchema,
    name: z.string().min(1).max(80),
    dimType: z.enum(["standard", "time", "version"]).default("standard"),
    members: z.array(memberSchema).max(2000).default([]),
  }),
  z.object({
    type: z.literal("create_model"),
    code: codeSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullish(),
    dimensionCodes: z.array(z.string().min(1)).min(1).max(MAX_MODEL_DIMENSIONS),
  }),
  z.object({
    type: z.literal("create_measure"),
    modelCode: z.string().min(1),
    code: codeSchema,
    name: z.string().min(1).max(120),
  }),
  z.object({
    type: z.literal("create_report"),
    modelCode: z.string().min(1),
    name: z.string().min(1).max(120),
    rows: z.array(z.string().min(1)).min(1).max(3),
    cols: z.array(z.string().min(1)).min(1).max(2),
    filters: z.record(z.string(), z.array(z.string())).optional(),
    shared: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("upload_facts"),
    modelCode: z.string().min(1),
    rows: z
      .array(
        z.object({
          coords: z.record(z.string(), z.string()),
          value: z.number(),
          values: z.record(z.string(), z.number()).optional(),
        })
      )
      .min(1)
      .max(5000),
  }),
  z.object({
    // Salt-okunur analiz — axet CLI'ye verinin bir ozetini gonderip anormal
    // gorunen hucreleri bulmasini ister. HICBIR facts/model yazimi yapmaz;
    // SADECE istege bagli olarak bir rapora/hucreye yorum (comment) ekler
    // (bu da onizlemede yazilmaz, sadece apply'da).
    type: z.literal("analyze_anomalies"),
    modelCode: z.string().min(1),
    rowDim: z.string().min(1),
    colDim: z.string().min(1),
    filters: z.record(z.string(), z.array(z.string())).optional(),
    measureCode: z.string().max(40).optional(),
    attachToReport: z.string().max(120).optional(),
    attachCellComments: z.boolean().optional(),
  }),
  z.object({
    // VERSION tipi boyutta TEK bir koordinat kesiti (filters'ta diger TUM
    // boyutlar icin TAM OLARAK bir deger) uzerinde axet CLI ile ileri donuk
    // tahmin uretir, hedef VERSION uyesi yoksa olusturur ve tahmini SADECE
    // birincil (slot 1) olcuye yazar.
    type: z.literal("forecast_measure"),
    modelCode: z.string().min(1),
    timeDim: z.string().min(1),
    sourceVersionCode: z.string().min(1),
    targetVersionCode: codeSchema,
    targetVersionName: z.string().min(1).max(120),
    periods: z.number().int().min(1).max(24),
    filters: z.record(z.string(), z.array(z.string())).optional(),
    measureCode: z.string().max(40).optional(),
  }),
  z.object({
    // Var olan bir raporun VERSION filtresine/sutununa yeni kodlar ekler
    // (karsilastirma amacli) — SADECE raporun SAHIBI guncelleyebilir (REST
    // /api/reports/[id] PUT ile AYNI kural, admin istisnasi dahi YOK).
    type: z.literal("update_report_add_comparison"),
    reportName: z.string().min(1).max(120),
    versionCodes: z.array(z.string().min(1)).min(1).max(10),
  }),
  z.object({
    type: z.literal("create_comment"),
    reportName: z.string().min(1).max(120),
    target: z.enum(["report", "cell"]).default("report"),
    cellRowCode: z.string().optional(),
    cellColCode: z.string().optional(),
    text: z.string().min(1).max(2000),
  }),
]);

export type DevAction = z.infer<typeof devActionSchema>;
export type UploadFactsRow = Extract<DevAction, { type: "upload_facts" }>["rows"][number];

// Bir plandaki toplam eylem sayisi sinirli (hem kotuye kullanim hem de
// "tek seferde cok fazla sey degisti" riskini azaltmak icin) — gercekten
// cok eylemli bir ihtiyac varsa kullanici birden fazla plan calistirir.
export const MAX_PLAN_ACTIONS = 30;

export const devPlanSchema = z.object({
  summary: z.string().max(500).optional(),
  actions: z.array(devActionSchema).min(1).max(MAX_PLAN_ACTIONS),
});
export type DevPlan = z.infer<typeof devPlanSchema>;

export type ActionResult = {
  index: number;
  type: DevAction["type"];
  status: "created" | "exists" | "skipped" | "error";
  message: string;
  entityId?: number;
  entityCode?: string;
};

export type PlanContext = { tenantId: number; userId: number; role: Role };

function viewerBlocked(ctx: PlanContext): boolean {
  return ctx.role === "viewer";
}

type DimRef = { id: number; code: string; memberCodes: Set<string> };
type ModelRef = { id: number; code: string; dimCodes: string[] };

// dryRun=true: HICBIR SQL YAZMA ISLEMI yapilmaz (sadece SELECT) — plan
// onizlemesi icindir. dryRun=false: gercek DB yazimi (apply). Ayni fonksiyon
// her iki modda da KULLANILIR ki onizleme ile gercek uygulama arasinda
// davranis farki (ve dolayisiyla "onizlemede guvenli gorunup uygulamada
// farkli davranma" riski) olmasin. ASYNC: analyze_anomalies/forecast_measure
// axet CLI'yi cagirir (ag/surec gecikmesi) — eylemler SIRALI (await ile,
// paralel DEGIL) calistirilir ki axet CLI'ye ayni anda cok sayida istek
// gitmesin ve hata mesajlari eylem sirasina sadik kalsin.
export async function runPlan(plan: DevPlan, ctx: PlanContext, dryRun: boolean): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  // Bu calistirma sirasinda (henuz commit edilmemis olsa da dryRun'da
  // simule edilen) olusturulan/bilinen boyut ve modelleri izler — ayni
  // plan icinde sonraki bir eylem (orn. create_model), bu calistirmada
  // henuz DB'ye yazilmamis ama onceki bir adimda "olusturulacak" damgali
  // bir boyuta referans verebilsin diye.
  const knownDims = new Map<string, DimRef>();
  const knownModels = new Map<string, ModelRef>();
  let fakeId = -1;

  function findDim(code: string): DimRef | null {
    const known = knownDims.get(code);
    if (known) return known;
    const row = sqlite
      .prepare("SELECT id FROM dimensions WHERE code = ? AND tenant_id = ?")
      .get(code, ctx.tenantId) as { id: number } | undefined;
    if (!row) return null;
    const members = sqlite
      .prepare("SELECT code FROM dimension_members WHERE dimension_id = ?")
      .all(row.id) as Array<{ code: string }>;
    const ref: DimRef = { id: row.id, code, memberCodes: new Set(members.map((m) => m.code)) };
    knownDims.set(code, ref);
    return ref;
  }

  function findModel(code: string): ModelRef | null {
    const known = knownModels.get(code);
    if (known) return known;
    const row = sqlite
      .prepare("SELECT id FROM models WHERE code = ? AND tenant_id = ?")
      .get(code, ctx.tenantId) as { id: number } | undefined;
    if (!row) return null;
    const dims = sqlite
      .prepare(
        `SELECT d.code FROM model_dimensions md JOIN dimensions d ON d.id = md.dimension_id
         WHERE md.model_id = ? ORDER BY md.slot`
      )
      .all(row.id) as Array<{ code: string }>;
    const ref: ModelRef = { id: row.id, code, dimCodes: dims.map((d) => d.code) };
    knownModels.set(code, ref);
    return ref;
  }

  for (let index = 0; index < plan.actions.length; index++) {
    const action = plan.actions[index];
    try {
      results.push(await executeOne(action, index));
    } catch (e) {
      results.push({
        index,
        type: action.type,
        status: "error",
        message: e instanceof Error ? e.message : "Beklenmeyen hata",
      });
    }
  }
  return results;

  function executeOne(action: DevAction, index: number): Promise<ActionResult> | ActionResult {
    switch (action.type) {
      case "create_dimension":
        return doCreateDimension(action, index);
      case "create_model":
        return doCreateModel(action, index);
      case "create_measure":
        return doCreateMeasure(action, index);
      case "create_report":
        return doCreateReport(action, index);
      case "upload_facts":
        return doUploadFacts(action, index);
      case "analyze_anomalies":
        return doAnalyzeAnomalies(action, index);
      case "forecast_measure":
        return doForecastMeasure(action, index);
      case "update_report_add_comparison":
        return doUpdateReportComparison(action, index);
      case "create_comment":
        return doCreateComment(action, index);
    }
  }

  function doCreateDimension(
    action: Extract<DevAction, { type: "create_dimension" }>,
    index: number
  ): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol boyut oluşturamaz (viewer)" };
    }
    const existing = findDim(action.code);
    if (existing) {
      return {
        index,
        type: action.type,
        status: "exists",
        message: `"${action.code}" boyutu zaten var — yeniden kullanılacak`,
        entityId: existing.id,
        entityCode: action.code,
      };
    }
    let id: number;
    const memberCodes = new Set<string>();
    if (dryRun) {
      id = fakeId--;
    } else {
      id = Number(
        sqlite
          .prepare(
            "INSERT INTO dimensions (tenant_id, code, name, type, visibility) VALUES (?,?,?,?,'public')"
          )
          .run(ctx.tenantId, action.code, action.name, action.dimType).lastInsertRowid
      );
      logAudit(ctx.userId, "ai_dev.create_dimension", "dimension", id, { code: action.code, name: action.name });
    }
    const byCode = new Map<string, number>();
    for (const m of action.members) {
      const parentId = m.parentCode ? byCode.get(m.parentCode) ?? null : null;
      if (!dryRun) {
        const memberId = Number(
          sqlite
            .prepare(
              "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
            )
            .run(id, m.code, m.name, parentId, byCode.size).lastInsertRowid
        );
        byCode.set(m.code, memberId);
      } else {
        byCode.set(m.code, fakeId--);
      }
      memberCodes.add(m.code);
    }
    knownDims.set(action.code, { id, code: action.code, memberCodes });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni boyut: ${action.code} (${action.name}) — ${action.members.length} üye`,
      entityId: id,
      entityCode: action.code,
    };
  }

  function doCreateModel(action: Extract<DevAction, { type: "create_model" }>, index: number): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol model oluşturamaz (viewer)" };
    }
    const existingModel = findModel(action.code);
    if (existingModel) {
      return {
        index,
        type: action.type,
        status: "exists",
        message: `"${action.code}" modeli zaten var — yeniden kullanılacak`,
        entityId: existingModel.id,
        entityCode: action.code,
      };
    }
    if (new Set(action.dimensionCodes).size !== action.dimensionCodes.length) {
      return { index, type: action.type, status: "error", message: "Aynı boyut birden fazla kez verildi" };
    }
    const dimRefs: DimRef[] = [];
    for (const dc of action.dimensionCodes) {
      const dim = findDim(dc);
      if (!dim) {
        return { index, type: action.type, status: "error", message: `Boyut bulunamadı: ${dc}` };
      }
      dimRefs.push(dim);
    }
    let id: number;
    if (dryRun) {
      id = fakeId--;
    } else {
      id = Number(
        sqlite
          .prepare("INSERT INTO models (tenant_id, code, name, description, created_at) VALUES (?,?,?,?,?)")
          .run(ctx.tenantId, action.code, action.name, action.description ?? null, new Date().toISOString())
          .lastInsertRowid
      );
      const ins = sqlite.prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)");
      dimRefs.forEach((d, i) => ins.run(id, d.id, i + 1));
      logAudit(ctx.userId, "ai_dev.create_model", "model", id, {
        code: action.code,
        name: action.name,
        dimensionCodes: action.dimensionCodes,
      });
    }
    knownModels.set(action.code, { id, code: action.code, dimCodes: action.dimensionCodes });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni model: ${action.code} (${action.name}) — boyutlar: ${action.dimensionCodes.join(", ")}`,
      entityId: id,
      entityCode: action.code,
    };
  }

  function doCreateMeasure(action: Extract<DevAction, { type: "create_measure" }>, index: number): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol ölçü oluşturamaz (viewer)" };
    }
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    if (model.id < 0) {
      // Ayni planda bu adimdan once olusturulmus (henuz commit edilmemis,
      // dryRun) bir model — gercek slot/limit kontrolu apply asamasinda yapilir.
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni ölçü: ${action.code} (${action.name}) — model: ${action.modelCode}`,
      };
    }
    const existing = listEffectiveMeasures(model.id).find((m) => m.code === action.code);
    if (existing) {
      return {
        index,
        type: action.type,
        status: "exists",
        message: `"${action.code}" ölçüsü zaten var`,
        entityId: existing.id,
        entityCode: action.code,
      };
    }
    const current = listEffectiveMeasures(model.id).filter((m) => m.id !== 0);
    if (current.length >= MAX_MODEL_MEASURES) {
      return {
        index,
        type: action.type,
        status: "error",
        message: `Bir modele en fazla ${MAX_MODEL_MEASURES} ölçü eklenebilir`,
      };
    }
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni ölçü: ${action.code} (${action.name}) — model: ${action.modelCode}`,
      };
    }
    const measure = createModelMeasure({ modelId: model.id, code: action.code, name: action.name });
    logAudit(ctx.userId, "ai_dev.create_measure", "model_measure", measure.id, {
      modelCode: action.modelCode,
      code: action.code,
      name: action.name,
    });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni ölçü: ${action.code} (${action.name})`,
      entityId: measure.id,
      entityCode: action.code,
    };
  }

  function doCreateReport(action: Extract<DevAction, { type: "create_report" }>, index: number): ActionResult {
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    const dimCodes = new Set(model.dimCodes);
    for (const c of [...action.rows, ...action.cols]) {
      if (!dimCodes.has(c)) {
        return { index, type: action.type, status: "error", message: `Model boyutu değil: ${c}` };
      }
    }
    if (model.id < 0) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni rapor: ${action.name} — model: ${action.modelCode}`,
      };
    }
    const definition = {
      version: 2 as const,
      modelId: model.id,
      rows: action.rows,
      cols: action.cols,
      filters: action.filters ?? {},
      calcColumns: [],
      calcRows: [],
      condRules: [],
      options: { hideZero: false, subtotals: true, valueMode: "abs" as const, scale: 1 as const, decimals: 0 as const, topN: null, sort: null },
    };
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni rapor: ${action.name} (satır: ${action.rows.join(",")} / sütun: ${action.cols.join(",")})`,
      };
    }
    const now = new Date().toISOString();
    const id = Number(
      sqlite
        .prepare(
          "INSERT INTO reports (tenant_id, name, owner_id, model_id, definition, shared, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
        )
        .run(ctx.tenantId, action.name, ctx.userId, model.id, JSON.stringify(definition), action.shared ? 1 : 0, now, now)
        .lastInsertRowid
    );
    logAudit(ctx.userId, "ai_dev.create_report", "report", id, { name: action.name, modelCode: action.modelCode });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni rapor: ${action.name}`,
      entityId: id,
      entityCode: action.name,
    };
  }

  function doUploadFacts(action: Extract<DevAction, { type: "upload_facts" }>, index: number): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol veri yazamaz (viewer)" };
    }
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    if (model.id < 0) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `${action.rows.length} veri satırı yüklenecek — model: ${action.modelCode}`,
      };
    }
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `${action.rows.length} veri satırı yüklenecek`,
      };
    }
    const dims = getModelDims(model.id);
    const measures = listEffectiveMeasures(model.id);
    const measureCodeBySlot = new Map(measures.map((m) => [m.slot, m.code]));

    const now = new Date().toISOString();
    const uploadId = Number(
      sqlite
        .prepare(
          "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
        )
        .run(model.id, "AI ile geliştirme", ctx.userId, action.rows.length, now).lastInsertRowid
    );
    const factRows = action.rows.map((r) => {
      const coords = dims.map((d) => r.coords[d.code] ?? "");
      const values: Record<number, number | null> = {};
      for (const [slot, code] of measureCodeBySlot) {
        if (slot === 1) continue;
        values[slot] = r.values?.[code] ?? null;
      }
      return { coords, value: r.value, values: Object.keys(values).length > 0 ? values : undefined };
    });
    try {
      upsertFacts(model.id, dims, factRows, uploadId, now, ctx.userId);
    } catch (e) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      throw e;
    }
    logAudit(ctx.userId, "ai_dev.upload_facts", "upload", uploadId, {
      modelCode: action.modelCode,
      rows: action.rows.length,
    });
    return {
      index,
      type: action.type,
      status: "created",
      message: `${action.rows.length} veri satırı yüklendi`,
      entityId: uploadId,
    };
  }

  // --- Rapor/yorum okuma-yazma yardimcilari (analyze_anomalies/
  // update_report_add_comparison/create_comment TARAFINDAN paylasilir) ---

  type ReportRow = {
    id: number;
    name: string;
    owner_id: number;
    model_id: number;
    definition: string;
    shared: number;
    version: number;
  };

  function findReportByName(name: string): ReportRow | null {
    const row = sqlite
      .prepare(
        `SELECT id, name, owner_id, model_id, definition, shared, version FROM reports
         WHERE tenant_id = ? AND name = ? AND (owner_id = ? OR shared = 1)
         ORDER BY id DESC LIMIT 1`
      )
      .get(ctx.tenantId, name, ctx.userId) as ReportRow | undefined;
    return row ?? null;
  }

  // /api/reports/[id] PUT ile BIREBIR AYNI kural: sadece SAHIP guncelleyebilir
  // (admin istisnasi dahi YOK — mevcut REST route'un davranisina sadik kalinir).
  function canWriteReport(report: ReportRow): boolean {
    return report.owner_id === ctx.userId;
  }

  // lib/access.ts canAccessCommentEntity ile AYNI kural (report: sahip/
  // paylasilan/admin okuyabilir-yorum-ekleyebilir; cell: SADECE admin).
  function canCreateComment(target: "report" | "cell", report: ReportRow): boolean {
    if (target === "cell") return ctx.role === "admin";
    return ctx.role === "admin" || report.owner_id === ctx.userId || report.shared === 1;
  }

  function insertComment(entityType: "report" | "cell", entityId: number, cellKey: string | null, text: string) {
    sqlite
      .prepare(
        "INSERT INTO comments (entity_type, entity_id, cell_key, user_id, text, created_at) VALUES (?,?,?,?,?,?)"
      )
      .run(entityType, String(entityId), cellKey, ctx.userId, text, new Date().toISOString());
  }

  // --- analyze_anomalies: salt-okunur analiz, axet CLI'ye verinin bir
  // ozetini gonderip anormal gorunen hucreleri bulmasini ister. ---
  async function doAnalyzeAnomalies(
    action: Extract<DevAction, { type: "analyze_anomalies" }>,
    index: number
  ): Promise<ActionResult> {
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    if (model.id < 0) {
      return {
        index,
        type: action.type,
        status: "skipped",
        message: "Model henüz commit edilmedi, analiz bir sonraki çalıştırmada yapılabilir.",
      };
    }
    if (!dimsHave(model, [action.rowDim, action.colDim])) {
      return { index, type: action.type, status: "error", message: "rowDim/colDim modelin boyutu değil" };
    }
    const result = runQuery(model.id, action.rowDim, action.colDim, action.filters ?? {}, ctx.userId, undefined, action.measureCode);
    if ("error" in result) {
      return { index, type: action.type, status: "error", message: `Sorgu hatası: ${result.error}` };
    }
    if (!axetAvailable()) {
      return {
        index,
        type: action.type,
        status: "error",
        message: "Anomali analizi axet-code CLI gerektiriyor, şu an erişilemiyor.",
      };
    }
    const { t } = await getServerT();
    const rowsForPrompt = result.rows.slice(0, 30);
    const colsForPrompt = result.cols.slice(0, 24);
    const lines = rowsForPrompt.map(
      (r) => `${r.code} (${r.name}): ` + colsForPrompt.map((c) => `${c.code}=${r.cells[c.code] ?? 0}`).join(", ")
    );
    const prompt = `Sen bir planlama/raporlama uygulamasında veri analistisin. Aşağıdaki tabloda (satır: ${action.rowDim}, sütun: ${action.colDim}, model: ${action.modelCode}) anormal görünen (beklenenden çok yüksek/düşük, ani sıçrama, negatif olmaması gereken yerde negatif vb.) hücreleri bul.

Veri:
${lines.join("\n")}

SADECE şu JSON şemasında yanıt ver, başka açıklama yazma:
{"summary":"kısa Türkçe özet","findings":[{"row":"SATIR_KODU","col":"SUTUN_KODU","reason":"neden anormal"}]}
En fazla 20 bulgu döndür. Hiçbir anormallik yoksa findings:[] ve summary:"Anormallik bulunamadı" döndür.`;

    let parsed: { summary: string; findings: Array<{ row: string; col?: string; reason: string }> };
    try {
      const output = await runAxet(prompt, t);
      const json = extractJson(output);
      const schema = z.object({
        summary: z.string().max(1000).optional().default(""),
        findings: z
          .array(z.object({ row: z.string(), col: z.string().optional(), reason: z.string().max(300) }))
          .max(20)
          .optional()
          .default([]),
      });
      const validated = schema.safeParse(json);
      if (!validated.success) {
        return { index, type: action.type, status: "error", message: "axet yanıtı anlaşılamadı" };
      }
      parsed = validated.data;
    } catch (e) {
      return {
        index,
        type: action.type,
        status: "error",
        message: e instanceof Error ? e.message.slice(0, 200) : "axet çağrısı başarısız",
      };
    }

    let commentNote = "";
    if (action.attachToReport) {
      const report = findReportByName(action.attachToReport);
      if (!report) {
        commentNote = ` (rapor bulunamadı: ${action.attachToReport}, yorum eklenemedi)`;
      } else if (!canCreateComment("report", report)) {
        commentNote = " (bu rapora yorum ekleme yetkiniz yok)";
      } else if (!dryRun) {
        insertComment(
          "report",
          report.id,
          null,
          `🤖 AI anomali analizi: ${parsed.summary || "Anormallik bulunamadı"}`
        );
        commentNote = ` (rapor yorumu eklendi: ${action.attachToReport})`;
        if (action.attachCellComments && parsed.findings.length > 0) {
          if (ctx.role !== "admin") {
            commentNote += " [hücre yorumları atlandı: admin değil]";
          } else {
            for (const f of parsed.findings) {
              insertComment("cell", report.id, `${f.row}|${f.col ?? "TOPLAM"}`, `🤖 ${f.reason}`);
            }
            commentNote += ` + ${parsed.findings.length} hücre yorumu`;
          }
        }
      } else {
        commentNote = ` (onaylanırsa rapor yorumu eklenecek: ${action.attachToReport})`;
      }
    }

    return {
      index,
      type: action.type,
      status: "created",
      message: `Analiz: ${parsed.summary || "Anormallik bulunamadı"} (${parsed.findings.length} bulgu)${commentNote}`,
    };
  }

  // --- forecast_measure: TEK bir koordinat kesiti uzerinde axet CLI ile
  // ileri donuk tahmin uretir, hedef VERSION uyesini (yoksa) olusturur ve
  // tahmini SADECE birincil (slot 1) olcuye yazar. ---
  async function doForecastMeasure(
    action: Extract<DevAction, { type: "forecast_measure" }>,
    index: number
  ): Promise<ActionResult> {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol tahmin yazamaz (viewer)" };
    }
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    if (model.id < 0) {
      return {
        index,
        type: action.type,
        status: "skipped",
        message: "Model henüz commit edilmedi, tahmin bir sonraki çalıştırmada yapılabilir.",
      };
    }
    const dims = getModelDims(model.id);
    const timeDim = dims.find((d) => d.code === action.timeDim);
    if (!timeDim) {
      return { index, type: action.type, status: "error", message: `Zaman boyutu bulunamadı: ${action.timeDim}` };
    }
    const versionDim = dims.find((d) => d.type === "version");
    if (!versionDim) {
      return { index, type: action.type, status: "error", message: "Model bir VERSION boyutuna sahip değil" };
    }
    if (!versionDim.members.some((m) => m.code === action.sourceVersionCode)) {
      return {
        index,
        type: action.type,
        status: "error",
        message: `Kaynak versiyon bulunamadı: ${action.sourceVersionCode}`,
      };
    }
    if (action.targetVersionCode === action.sourceVersionCode) {
      return { index, type: action.type, status: "error", message: "Hedef versiyon kaynaktan farklı olmalı" };
    }
    // Tahmin TEK bir koordinat kesiti uzerinde calisir: zaman ve versiyon
    // disindaki HER boyut icin filters'ta TAM OLARAK bir deger belirtilmis
    // olmali (aksi halde "hangi satirin tahmin edildigi" belirsizlesir).
    for (const d of dims) {
      if (d.code === timeDim.code || d.code === versionDim.code) continue;
      const vals = action.filters?.[d.code];
      if (!vals || vals.length !== 1) {
        return {
          index,
          type: action.type,
          status: "error",
          message: `"${d.code}" için filters'ta tek bir değer belirtmelisiniz (tahmin tek bir koordinat kesiti için çalışır)`,
        };
      }
    }
    const measures = listEffectiveMeasures(model.id);
    const targetMeasure =
      (action.measureCode ? measures.find((m) => m.code === action.measureCode) : undefined) ??
      measures.find((m) => m.slot === 1) ??
      measures[0];
    if (targetMeasure.slot !== 1) {
      return {
        index,
        type: action.type,
        status: "error",
        message: "Tahmin şu an sadece birincil (slot 1) ölçü için desteklenir",
      };
    }

    const queryFilters = { ...(action.filters ?? {}), [versionDim.code]: [action.sourceVersionCode] };
    const result = runQuery(model.id, versionDim.code, timeDim.code, queryFilters, ctx.userId, undefined, action.measureCode);
    if ("error" in result) {
      return { index, type: action.type, status: "error", message: `Sorgu hatası: ${result.error}` };
    }
    const row = result.rows.find((r) => r.code === action.sourceVersionCode);
    if (!row || Object.keys(row.cells).length === 0) {
      return { index, type: action.type, status: "error", message: "Kaynak versiyon için geçmiş veri bulunamadı" };
    }
    const history = result.cols.map((c) => ({ code: c.code, name: c.name, value: row.cells[c.code] ?? 0 }));

    const allTimeMembers = [...timeDim.members].sort((a, b) => a.orderIdx - b.orderIdx);
    const lastDataCode = history[history.length - 1]?.code;
    const lastIdx = allTimeMembers.findIndex((m) => m.code === lastDataCode);
    const futurePeriods = (lastIdx < 0 ? [] : allTimeMembers.slice(lastIdx + 1)).slice(0, action.periods);
    if (futurePeriods.length === 0) {
      return {
        index,
        type: action.type,
        status: "error",
        message:
          "Boyutta tahmin için gelecek dönem üyesi tanımlı değil (önce ilgili zaman boyutuna gelecek dönemler eklenmeli)",
      };
    }

    if (!axetAvailable()) {
      return {
        index,
        type: action.type,
        status: "error",
        message: "Tahmin için axet-code CLI gerekiyor, şu an erişilemiyor.",
      };
    }
    const { t } = await getServerT();
    const histLines = history.map((h) => `${h.code} (${h.name}) = ${h.value}`).join("\n");
    const futureCodes = futurePeriods.map((f) => f.code);
    const prompt = `Sen bir planlama/raporlama uygulamasında zaman serisi tahmin uzmanısın. Model: ${action.modelCode}, Ölçü: ${targetMeasure.name}.

Geçmiş veri (kronolojik sıra):
${histLines}

Aşağıdaki GELECEK dönemler için tahmini sayısal değer üret: ${futureCodes.join(", ")}

SADECE şu JSON şemasında yanıt ver, başka açıklama yazma, TÜM istenen dönem kodlarını içermeli:
{"values": {"${futureCodes[0]}": 0}}`;

    let forecastValues: Record<string, number>;
    try {
      const output = await runAxet(prompt, t);
      const json = extractJson(output);
      const schema = z.object({ values: z.record(z.string(), z.number()) });
      const validated = schema.safeParse(json);
      if (!validated.success) {
        return { index, type: action.type, status: "error", message: "axet yanıtı anlaşılamadı" };
      }
      const missing = futureCodes.filter((c) => !(c in validated.data.values));
      if (missing.length > 0) {
        return {
          index,
          type: action.type,
          status: "error",
          message: `axet yanıtı eksik dönemler içeriyor: ${missing.join(", ")}`,
        };
      }
      forecastValues = validated.data.values;
    } catch (e) {
      return {
        index,
        type: action.type,
        status: "error",
        message: e instanceof Error ? e.message.slice(0, 200) : "axet çağrısı başarısız",
      };
    }

    const preview = futurePeriods.map((p) => `${p.code}=${forecastValues[p.code]}`).join(", ");
    const targetExists = versionDim.members.some((m) => m.code === action.targetVersionCode);
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `Tahmin (${preview}) → ${action.targetVersionCode}${
          targetExists ? "" : " (yeni versiyon oluşturulacak)"
        } versiyonuna yazılacak`,
      };
    }

    if (!targetExists) {
      sqlite
        .prepare("INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)")
        .run(versionDim.id, action.targetVersionCode, action.targetVersionName, null, versionDim.members.length);
    }

    const now = new Date().toISOString();
    const uploadId = Number(
      sqlite
        .prepare(
          "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
        )
        .run(model.id, "AI tahmin", ctx.userId, futurePeriods.length, now).lastInsertRowid
    );
    const factRows = futurePeriods.map((p) => ({
      coords: dims.map((d) => {
        if (d.code === timeDim.code) return p.code;
        if (d.code === versionDim.code) return action.targetVersionCode;
        return action.filters![d.code][0];
      }),
      value: forecastValues[p.code],
    }));
    try {
      upsertFacts(model.id, dims, factRows, uploadId, now, ctx.userId);
    } catch (e) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      throw e;
    }
    logAudit(ctx.userId, "ai_dev.forecast_measure", "upload", uploadId, {
      modelCode: action.modelCode,
      targetVersionCode: action.targetVersionCode,
      periods: futureCodes,
    });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Tahmin (${preview}) → ${action.targetVersionCode} versiyonuna yazıldı`,
      entityId: uploadId,
    };
  }

  // --- update_report_add_comparison: var olan bir raporun VERSION filtresine/
  // sutununa yeni kodlar ekler. ---
  async function doUpdateReportComparison(
    action: Extract<DevAction, { type: "update_report_add_comparison" }>,
    index: number
  ): Promise<ActionResult> {
    const report = findReportByName(action.reportName);
    if (!report) {
      return { index, type: action.type, status: "error", message: `Rapor bulunamadı: ${action.reportName}` };
    }
    if (!canWriteReport(report)) {
      return { index, type: action.type, status: "error", message: "Bu raporu güncelleme yetkiniz yok (sahibi değilsiniz)" };
    }
    const dims = getModelDims(report.model_id);
    const versionDim = dims.find((d) => d.type === "version");
    if (!versionDim) {
      return { index, type: action.type, status: "error", message: "Raporun modeli bir VERSION boyutuna sahip değil" };
    }
    const validCodes = new Set(versionDim.members.map((m) => m.code));
    const missing = action.versionCodes.filter((c) => !validCodes.has(c));
    if (missing.length > 0) {
      return { index, type: action.type, status: "error", message: `Geçersiz versiyon kodu: ${missing.join(", ")}` };
    }
    const def = JSON.parse(report.definition) as ReportDefV2;
    const cols = def.cols.includes(versionDim.code) || def.rows.includes(versionDim.code)
      ? def.cols
      : [...def.cols, versionDim.code];
    const filters = {
      ...def.filters,
      [versionDim.code]: [...new Set([...(def.filters[versionDim.code] ?? []), ...action.versionCodes])],
    };
    const newDef: ReportDefV2 = { ...def, cols, filters };

    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `"${action.reportName}" raporuna ${action.versionCodes.join(", ")} karşılaştırması eklenecek`,
      };
    }

    const result = versionedUpdate(
      "reports",
      report.id,
      report.version,
      undefined,
      "definition = ?, updated_at = ?",
      [JSON.stringify(newDef), new Date().toISOString()]
    );
    if (!result.ok) {
      return { index, type: action.type, status: "error", message: "Rapor başka biri tarafından güncellenmiş (çakışma)" };
    }
    logAudit(ctx.userId, "ai_dev.update_report_add_comparison", "report", report.id, {
      reportName: action.reportName,
      versionCodes: action.versionCodes,
    });
    return {
      index,
      type: action.type,
      status: "created",
      message: `"${action.reportName}" raporuna ${action.versionCodes.join(", ")} karşılaştırması eklendi`,
      entityId: report.id,
    };
  }

  // --- create_comment: var olan bir rapora (veya hucresine) yorum ekler. ---
  async function doCreateComment(
    action: Extract<DevAction, { type: "create_comment" }>,
    index: number
  ): Promise<ActionResult> {
    const report = findReportByName(action.reportName);
    if (!report) {
      return { index, type: action.type, status: "error", message: `Rapor bulunamadı: ${action.reportName}` };
    }
    if (!canCreateComment(action.target, report)) {
      return {
        index,
        type: action.type,
        status: "error",
        message:
          action.target === "cell" ? "Hücre yorumu sadece admin ekleyebilir" : "Bu rapora yorum ekleme yetkiniz yok",
      };
    }
    if (action.target === "cell" && !action.cellRowCode) {
      return { index, type: action.type, status: "error", message: "Hücre yorumu için cellRowCode gerekli" };
    }
    const cellKey = action.target === "cell" ? `${action.cellRowCode}|${action.cellColCode ?? "TOPLAM"}` : null;
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `"${action.reportName}" raporuna yorum eklenecek${cellKey ? ` (hücre: ${cellKey})` : ""}`,
      };
    }
    insertComment(action.target, report.id, cellKey, action.text);
    logAudit(ctx.userId, "ai_dev.create_comment", "report", report.id, { reportName: action.reportName, cellKey });
    return {
      index,
      type: action.type,
      status: "created",
      message: `"${action.reportName}" raporuna yorum eklendi${cellKey ? ` (hücre: ${cellKey})` : ""}`,
      entityId: report.id,
    };
  }

  function dimsHave(model: ModelRef, codes: string[]): boolean {
    const set = new Set(model.dimCodes);
    return codes.every((c) => set.has(c));
  }
}
